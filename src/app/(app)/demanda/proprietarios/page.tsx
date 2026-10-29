import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { env } from "@/lib/env";
import { canSeeOwnerLeads, LEAD_STATUS, listOwnerLeads, type LeadStatus } from "@/server/owner-leads";
import { whatsappUrl } from "@/lib/confirm";
import { formatPhone } from "@/lib/phone";
import { fmt } from "@/lib/time";
import { Empty, PageHeader, cx } from "@/components/ui";
import { BriefActions } from "@/components/brief-actions";
import { LeadActions } from "./actions";

export const metadata = { title: "Proprietários" };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const TONE: Record<LeadStatus, string> = { NEW: "bg-accent-soft text-accent-strong", CONTACTED: "bg-warn-soft text-warn", VISITED: "bg-warn-soft text-warn", CAPTURED: "bg-good-soft text-good", LOST: "bg-tint text-ink-2" };

/** Proprietários que pediram contato pela página "Quanto rende o seu imóvel?". */
export default async function OwnerLeadsPage() {
  const actor = await requireActor({ capture: true });
  if (!canSeeOwnerLeads(actor)) notFound();
  const rows = await listOwnerLeads(actor);
  const link = `${env.appUrl}/quanto-rende`;
  const share = `Tem imóvel para alugar em Canoas? Descubra em segundos quanto ele rende e quantos clientes da Auxiliadora procuram um imóvel como o seu agora: ${link}`;
  const open = rows.filter((r) => r.status !== "CAPTURED" && r.status !== "LOST");
  const done = rows.filter((r) => r.status === "CAPTURED" || r.status === "LOST");
  const card = (r: (typeof rows)[number]) => {
    const st = r.status as LeadStatus;
    const first = r.name.split(" ")[0];
    const what = [r.propertyType.toLowerCase(), r.bedrooms != null ? `de ${r.bedrooms} quarto${r.bedrooms === 1 ? "" : "s"}` : null, `no ${r.area}`].filter(Boolean).join(" ");
    const msg = `Olá, ${first}! Aqui é ${actor.name.split(" ")[0]}, da captação da Auxiliadora Predial. Vi que você consultou quanto rende o seu ${what}.${r.demand ? ` Hoje temos ${r.demand} cliente${r.demand > 1 ? "s" : ""} procurando um imóvel assim.` : ""} Podemos conversar sobre a locação?`;
    const closed = st === "CAPTURED" || st === "LOST";
    return (
      <li key={r.id} className={cx("min-w-0 rounded-3xl border bg-surface p-4 shadow-card", st === "NEW" ? "border-accent/40" : "border-line")}>
        <div className="flex items-center justify-between gap-2">
          <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-bold", TONE[st])}>{LEAD_STATUS[st]}</span>
          <span className="text-[12px] text-ink-3">{r.days === 0 ? "hoje" : `há ${r.days} dia${r.days === 1 ? "" : "s"}`}</span>
        </div>
        <p className="mt-2 text-[16px] font-bold">{r.name}</p>
        <p className="text-[14px] text-ink-2">
          {r.propertyType}
          {r.bedrooms != null ? ` · ${r.bedrooms} qto${r.bedrooms === 1 ? "" : "s"}` : ""} · {r.area}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
          {r.demand > 0 && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent-strong">
              🔥 {r.demand} cliente{r.demand > 1 ? "s" : ""} procurando
            </span>
          )}
          {r.estimateCents ? <span className="rounded-full bg-tint px-2 py-0.5">estimado {brl(r.estimateCents)}</span> : null}
          {r.wantedCents ? <span className="rounded-full bg-tint px-2 py-0.5">quer {brl(r.wantedCents)}</span> : null}
        </div>
        {r.message && <p className="mt-2 rounded-xl bg-tint px-3 py-2 text-[13px] text-ink-2">“{r.message}”</p>}
        {r.handler && <p className="mt-2 text-[13px] font-semibold text-ink-2">👤 {r.handler.id === actor.id ? "Você está atendendo" : `${r.handler.name.split(" ")[0]} está atendendo`}</p>}
        {r.note && <p className="mt-1 text-[13px] text-ink-3">Obs.: {r.note}</p>}
        {r.phone && !closed && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a href={whatsappUrl(r.phone, msg)} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-10 items-center rounded-full bg-[#1fa855] px-4 text-[13px] font-semibold text-white">
              WhatsApp com mensagem pronta
            </a>
            <a href={`tel:${r.phone}`} className="press inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 text-[13px] font-semibold">
              Ligar {formatPhone(r.phone)}
            </a>
          </div>
        )}
        <LeadActions id={r.id} status={st} mine={r.handler?.id === actor.id} taken={!!r.handler} note={r.note ?? ""} />
        <p className="mt-2 text-[11px] text-ink-3">Pedido em {fmt.dateTime(r.createdAt)} · autorizou o contato (LGPD)</p>
      </li>
    );
  };
  return (
    <>
      <PageHeader title="Proprietários" subtitle="Donos de imóvel que consultaram “Quanto rende o seu imóvel?” e pediram contato. Chame no mesmo dia." />
      <section className="mb-6 rounded-3xl border border-line bg-surface-2 p-4">
        <p className="text-[14px] font-bold">Divulgue a página e receba proprietários</p>
        <p className="mt-0.5 mb-3 text-[13px] text-ink-3">Mande no WhatsApp, poste no Instagram ou coloque nas placas. Quem pedir contato aparece aqui e você recebe um aviso.</p>
        <p className="mb-3 truncate rounded-xl bg-surface px-3 py-2 font-mono text-[13px]">{link}</p>
        <BriefActions text={share} />
      </section>
      {rows.length === 0 ? (
        <Empty title="Nenhum proprietário ainda" icon="⌂">
          Divulgue o link acima: cada proprietário que pedir contato aparece aqui na hora.
        </Empty>
      ) : (
        <>
          <h2 className="mb-3 text-[15px] font-bold">
            Para atender <span className="font-medium text-ink-3">· {open.length}</span>
          </h2>
          {open.length ? <ul className="mb-8 grid items-start gap-3 lg:grid-cols-2">{open.map(card)}</ul> : <p className="mb-8 text-[14px] text-ink-3">Tudo atendido.</p>}
          {done.length > 0 && (
            <details className="group">
              <summary className="mb-3 cursor-pointer list-none text-[15px] font-bold">
                Encerrados (60 dias) <span className="font-medium text-ink-3">· {done.length}</span> <span className="text-ink-3">›</span>
              </summary>
              <ul className="grid items-start gap-3 lg:grid-cols-2">{done.map(card)}</ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
