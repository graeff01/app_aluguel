import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { RADAR_STATUS_LABEL, canUseRadar, isRadarDue, listRadar, radarAgeDays, type RadarTab } from "@/server/radar";
import { brl } from "@/server/proposals";
import { dateOnlyKey, dayKey, fmt } from "@/lib/time";
import { Empty, LinkButton, PageHeader, Segmented, cx } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "Radar de clientes" };

const br = (k: string) => k.split("-").reverse().slice(0, 2).join("/");

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ aba?: string; q?: string }> }) {
  const actor = await requireActor({ preService: true });
  if (!canUseRadar(actor)) notFound();
  const sp = await searchParams;
  const tab: RadarTab = sp.aba === "cobrar" || sp.aba === "encerrados" ? sp.aba : "abertos";
  const now = new Date();
  const today = dayKey(now);
  const rows = await listRadar(actor, { tab, q: sp.q }, now);
  return (
    <>
      <PageHeader
        title="Radar de clientes"
        subtitle="Clientes que procuram um perfil que não temos na base. O pedido vai para a captação e fica aqui até ter resposta."
        action={
          <LinkButton href="/radar/novo">
            <Icon name="plus" className="size-4" /> Novo no radar
          </LinkButton>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Situação"
          items={[
            { href: "/radar?aba=cobrar", label: "Cobrar hoje", active: tab === "cobrar" },
            { href: "/radar", label: "Em aberto", active: tab === "abertos" },
            { href: "/radar?aba=encerrados", label: "Encerrados", active: tab === "encerrados" },
          ]}
        />
        <form role="search" className="w-full sm:w-72">
          {tab !== "abertos" && <input type="hidden" name="aba" value={tab} />}
          <label htmlFor="q" className="sr-only">
            Buscar por nome, perfil ou imóvel
          </label>
          <input id="q" name="q" type="search" defaultValue={sp.q} placeholder="Buscar por nome, perfil ou imóvel" className="block min-h-11 w-full rounded-full border border-line-strong bg-surface px-5 text-[15px] shadow-card focus:border-ink focus:outline-none" />
        </form>
      </div>
      {rows.length === 0 ? (
        <Empty title={tab === "cobrar" ? "Nada para cobrar hoje" : tab === "abertos" ? "Nenhum cliente no radar" : "Nenhum encerrado ainda"} icon="✓">
          {tab === "abertos" ? "Use “Novo no radar” quando o cliente procura um perfil que não temos e o pedido vai para a captação." : undefined}
        </Empty>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((r, i) => {
            const due = isRadarDue(r, now);
            const follow = dateOnlyKey(r.followUpOn);
            const profile = [r.propertyType, r.bedrooms ? `${r.bedrooms} quarto${r.bedrooms > 1 ? "s" : ""}` : null, r.maxBudgetCents ? `até ${brl(r.maxBudgetCents)}` : null, r.areas.length ? r.areas.join(", ") : null].filter(Boolean).join(" · ");
            return (
              <li key={r.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
                <Link href={`/radar/${r.id}`} className={cx("press block h-full rounded-3xl border bg-surface p-4 shadow-card hover:shadow-float", due ? "border-bad/40" : "border-line")}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-[16px] font-bold">{r.clientName}</p>
                    <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold", r.status === "FOUND" ? "bg-good-soft text-good" : r.status === "CLOSED" ? "bg-tint text-ink-2" : "bg-accent-soft text-accent-strong")}>
                      {r.status === "CLOSED" ? (r.closeReason ?? RADAR_STATUS_LABEL.CLOSED) : RADAR_STATUS_LABEL[r.status]}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[14px] text-ink-2">{r.wants}</p>
                  {profile && <p className="mt-1 truncate text-[12px] text-ink-3">{profile}</p>}
                  {r.foundCodes.length > 0 && <p className="mt-1 text-[12px] font-semibold text-good">Imóveis: {r.foundCodes.join(", ")}</p>}
                  <p className={cx("mt-1.5 text-[12px]", due ? "font-bold text-bad" : "text-ink-3")}>
                    {r.status === "CLOSED"
                      ? `Encerrado em ${r.closedAt ? fmt.shortDate(r.closedAt) : "—"}`
                      : `${r.sentToCaptureAt ? `Com a captação há ${radarAgeDays(r, now)} dia${radarAgeDays(r, now) === 1 ? "" : "s"}` : "Ainda não passou à captação"} · ${due ? (follow < today ? `cobrar desde ${br(follow)}` : "cobrar hoje") : `cobrar em ${br(follow)}`}`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
