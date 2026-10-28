import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { db } from "@/lib/db";
import { dateOnlyKey, fmt } from "@/lib/time";
import { cx, Segmented } from "@/components/ui";
import { ContactButtons } from "@/components/contact-buttons";
import { PropertyThumb } from "@/components/property-thumb";
import { EVALUATION_LABEL } from "@/lib/labels";
import { listClientSearches, SEARCH_CLOSE_LABEL, SEARCH_STALE_DAYS, searchStats } from "@/server/client-search";

export const metadata = { title: "Clientes em busca" };
/** data sem hora (gravada em UTC): não passa pelo fuso */
const dOnly = (d: Date) => dateOnlyKey(d).split("-").reverse().slice(0, 2).join("/");
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Clientes que recusaram um imóvel mas seguem procurando outro. */
export default async function SearchesPage({ searchParams }: { searchParams: Promise<{ aba?: string; consultora?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const global = hasGlobalView(actor);
  const tab = sp.aba === "encerradas" ? "encerradas" : "ativas";
  const now = new Date();
  const items = await listClientSearches(actor, { tab, consultantId: sp.consultora }, now);
  const stats = global ? await searchStats(actor, new Date(now.getTime() - 90 * 86400_000), now) : null;
  const consultants = global ? await db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const qs = (o: { aba?: string; consultora?: string }) => {
    const p = new URLSearchParams();
    if ((o.aba ?? tab) === "encerradas") p.set("aba", "encerradas");
    const c = o.consultora === undefined ? sp.consultora : o.consultora;
    if (c) p.set("consultora", c);
    const t = p.toString();
    return `/em-busca${t ? `?${t}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase">Clientes</p>
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.035em]">Clientes em busca</h1>
      <p className="mt-1.5 mb-5 text-[15px] text-ink-2">Recusaram um imóvel, mas continuam procurando. Ofereça outras opções antes que aluguem em outro lugar.</p>

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Em busca", String(stats.active), ""],
            ["Esfriando", String(stats.stale), `sem contato há ${SEARCH_STALE_DAYS}+ dias`],
            ["Alugaram conosco", String(stats.won), stats.conversion !== null ? `${Math.round(stats.conversion * 100)}% das encerradas (90 dias)` : "últimos 90 dias"],
            ["Perdidos", String(stats.lostElsewhere + stats.gaveUp), `${stats.lostElsewhere} em outro lugar · ${stats.gaveUp} desistiram`],
          ].map(([k, v, sub]) => (
            <div key={k} className="rounded-[22px] border border-line bg-surface px-4 py-3.5 shadow-card">
              <p className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{k}</p>
              <p className="num mt-0.5 text-[26px] font-bold">{v}</p>
              {sub && <p className="text-[12px] text-ink-3">{sub}</p>}
            </div>
          ))}
          {stats.avgDaysToWin !== null && <p className="col-span-full text-[13px] text-ink-3">Tempo médio da busca até alugar conosco: {stats.avgDaysToWin} dias.</p>}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          label="Situação"
          items={[
            { href: qs({ aba: "ativas" }), label: "Em busca", active: tab === "ativas" },
            { href: qs({ aba: "encerradas" }), label: "Encerradas", active: tab === "encerradas" },
          ]}
        />
        {global && (
          <form action="/em-busca" className="flex items-center gap-2">
            {tab === "encerradas" && <input type="hidden" name="aba" value="encerradas" />}
            <select name="consultora" defaultValue={sp.consultora ?? ""} className="min-h-11 rounded-full border border-line-strong bg-surface px-4 text-[14px]">
              <option value="">Todas as consultoras</option>
              {consultants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button className="min-h-11 rounded-full bg-tint px-4 text-[14px] font-semibold">Filtrar</button>
          </form>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-[26px] border border-dashed border-line-strong px-6 py-10 text-center">
          <p className="text-[16px] font-semibold">{tab === "ativas" ? "Nenhum cliente em busca agora." : "Nenhuma busca encerrada."}</p>
          {tab === "ativas" && (
            <p className="mt-1 text-[14px] text-ink-3">Ao registrar uma visita negativa, marque “Cliente segue procurando outro imóvel”. No negócio que caiu, use “Cliente segue em busca”.</p>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((s, i) => (
            <li key={s.id} className={cx("animate-rise relative overflow-hidden rounded-[26px] border bg-surface shadow-card", s.due ? "border-accent/40" : s.stale ? "border-bad/30" : "border-line")} style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
              {(s.due || s.stale) && <span aria-hidden className={cx("absolute inset-y-0 left-0 w-[5px]", s.due ? "bg-accent" : "bg-bad")} />}
              <Link href={`/em-busca/${s.id}`} className="press block px-5 pt-4 pb-3 sm:px-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-[18px] font-bold tracking-[-0.015em]">{s.client.anonymizedAt ? "Cliente (dados removidos)" : s.client.name}</p>
                  {s.status === "ACTIVE" ? (
                    <p className={cx("text-[12px] font-bold tracking-[0.06em] uppercase", s.due ? "text-accent-strong" : s.stale ? "text-bad" : "text-ink-3")}>
                      {s.due ? "Ligar hoje" : s.stale ? `Sem contato há ${s.silentDays} dias` : (s.days === 0 ? "Em busca desde hoje" : `Em busca há ${s.days} ${s.days === 1 ? "dia" : "dias"}`)}
                      {s.siteNewCodes.length > 0 && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] tracking-normal text-white normal-case">{s.siteNewCodes.length === 1 ? "1 novo no site" : `${s.siteNewCodes.length} novos no site`}</span>}
                    </p>
                  ) : (
                    <p className={cx("text-[12px] font-bold tracking-[0.06em] uppercase", s.status === "WON" ? "text-good" : "text-ink-3")}>{SEARCH_CLOSE_LABEL[s.status as keyof typeof SEARCH_CLOSE_LABEL]}</p>
                  )}
                </div>
                <p className="mt-1 text-[14px] text-ink-2">
                  {[
                    s.propertyType,
                    s.bedrooms != null ? `${s.bedrooms}+ quartos` : null,
                    s.maxBudgetCents ? `até ${brl(s.maxBudgetCents)}` : null,
                    s.areas.length ? s.areas.join(", ") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || <span className="text-ink-3">Perfil ainda não preenchido — toque para completar</span>}
                </p>
                {global && <p className="mt-0.5 text-[13px] text-ink-3">{s.consultant.name}</p>}
                {s.seen.length > 0 && (
                  <div className="mt-3 flex items-center gap-2 overflow-x-auto">
                    {s.seen.slice(0, 5).map((v) => (
                      <span key={v.id} className="flex shrink-0 items-center gap-2 rounded-full bg-tint py-1 pr-3 pl-1 text-[12px]">
                        <PropertyThumb photoUrl={v.property?.photoUrl} className="size-6 rounded-full" />
                        <span className="num font-semibold">{v.propertyCode}</span>
                        <span className="text-ink-3">{v.evaluation === "NEGATIVE" ? (v.negativeReason?.label ?? "recusou") : v.evaluation ? EVALUATION_LABEL[v.evaluation] : ""}</span>
                      </span>
                    ))}
                  </div>
                )}
              </Link>
              {s.status === "ACTIVE" && (
                <div className="flex flex-wrap items-center gap-2 px-5 pb-4 sm:px-6">
                  {s.phone && <ContactButtons phone={s.phone} name={s.client.name} compact />}
                  <span className="text-[12px] text-ink-3">
                    {s.lastContactAt ? `Último contato ${fmt.shortDate(s.lastContactAt).replace(".", "")}` : ""}
                    {s.followUpOn ? ` · próximo contato ${dOnly(s.followUpOn)}` : ""}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
