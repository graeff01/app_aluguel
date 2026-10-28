import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canSeeDemand, captureBrief, demandMap, segmentSupply, type DemandSegment } from "@/server/demand";
import type { AuthzActor } from "@/lib/authz";
import { brl } from "@/server/proposals";
import { Empty, PageHeader, Segmented, cx } from "@/components/ui";
import { BriefActions } from "./brief";

export const metadata = { title: "Mapa da demanda" };

/** Barras horizontais de uma série só (contagem), ordenadas; valor escrito ao lado e no toque/hover. */
function Bars({ title, items, unit = "pedido", empty }: { title: string; items: { label: string; count: number }[]; unit?: string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const shown = items.filter((i) => i.count > 0);
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-[15px] font-bold">{title}</h2>
      {shown.length === 0 ? (
        <p className="text-[13px] text-ink-3">{empty ?? "Sem dados no período."}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((i) => (
            <li key={i.label} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 text-[13px]" title={`${i.label}: ${i.count} ${unit}${i.count === 1 ? "" : "s"}`}>
              <span className="truncate text-ink-2">{i.label}</span>
              <span className="h-4 overflow-hidden rounded-r-[4px] bg-tint" aria-hidden>
                <span className="block h-full rounded-r-[4px] bg-accent" style={{ width: `${(i.count / max) * 100}%` }} />
              </span>
              <span className="num font-semibold">{i.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const GAP = {
  none: { label: "Sem oferta · captar", cls: "bg-bad-soft text-bad" },
  low: { label: "Pouca oferta", cls: "bg-warn-soft text-warn" },
  ok: { label: "Tem no site · ofereça", cls: "bg-good-soft text-good" },
} as const;

async function Gaps({ actor, segments, days }: { actor: AuthzActor; segments: DemandSegment[]; days: number }) {
  const rows = await segmentSupply(actor, segments);
  const brief = captureBrief(days, rows);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line text-[12px] tracking-wide text-ink-3 uppercase">
              <th className="py-2 pr-3 font-semibold">O que procuram</th>
              <th className="py-2 pr-3 text-right font-semibold">Clientes</th>
              <th className="py-2 pr-3 text-right font-semibold">No site hoje</th>
              <th className="py-2 font-semibold">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.area}|${r.type}`} className="border-b border-line last:border-b-0">
                <td className="py-2.5 pr-3">
                  <p className="font-semibold">
                    {r.type ?? "Qualquer tipo"} · {r.area}
                  </p>
                  <p className="text-[12px] text-ink-3">{[r.bedrooms ? `${r.bedrooms}+ quartos` : null, r.budgetCents ? `até ${brl(r.budgetCents)}` : null, r.open ? `${r.open} em aberto` : null].filter(Boolean).join(" · ") || "—"}</p>
                </td>
                <td className="num py-2.5 pr-3 text-right font-bold">{r.demand}</td>
                <td className="num py-2.5 pr-3 text-right">
                  {r.supply == null ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
                      {r.supply}
                    </a>
                  )}
                </td>
                <td className="py-2.5">{r.gap ? <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-bold", GAP[r.gap].cls)}>{GAP[r.gap].label}</span> : <span className="text-[12px] text-ink-3">site não respondeu</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-ink-3">“No site hoje”: imóveis no site com o mesmo bairro, tipo, quartos mínimos e aluguel até o valor mais pedido. Toque no número para ver a busca no site.</p>
      {brief && (
        <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
          <p className="mb-2 text-[14px] font-bold">Resumo para a captação</p>
          <pre className="mb-3 text-[13px] whitespace-pre-wrap text-ink-2" style={{ fontFamily: "inherit" }}>
            {brief}
          </pre>
          <BriefActions text={brief} />
        </div>
      )}
    </>
  );
}

export default async function DemandPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const actor = await requireActor({ capture: true });
  if (!canSeeDemand(actor)) notFound();
  const sp = await searchParams;
  const days = [30, 90, 180].includes(Number(sp.dias)) ? Number(sp.dias) : 90;
  const d = await demandMap(actor, { days });
  const c = d.capture;
  const tiles: [string, string, string][] = [
    ["Clientes procurando", String(d.total), `${d.radar} do radar · ${d.searches} em busca`],
    ["Ainda sem imóvel", String(d.open), "pedidos em aberto agora"],
    ["Resolvidos pela captação", c.closed ? `${Math.round((c.solveRate ?? 0) * 100)}%` : "—", c.closed ? `${c.solved} de ${c.closed} encerrados (agendou ou alugou)` : "nenhum encerrado no período"],
    ["Tempo até resolver", c.avgDaysToSolve != null ? `${c.avgDaysToSolve} d` : "—", "do pedido até agendar ou alugar"],
    ["Esperando há 15+ dias", String(c.waiting15), "pedidos do radar sem resposta"],
  ];
  return (
    <>
      <PageHeader title="Mapa da demanda" subtitle="O que os clientes procuram e não encontram, cruzado com o que existe hoje no site. Mostra onde a captação deve buscar." />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Período"
          items={[30, 90, 180].map((n) => ({ href: `/demanda?dias=${n}`, label: `${n} dias`, active: days === n }))}
        />
        <a href="/demanda/pedidos" className="press inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 text-[13px] font-semibold">
          Ver os pedidos em aberto →
        </a>
      </div>
      {d.total === 0 ? (
        <Empty title="Ainda não há pedidos no período" icon="◌">
          A demanda vem do Radar de clientes (pré-atendimento) e dos Clientes em busca (consultoras). Com o perfil preenchido (bairro, tipo, quartos e valor), o mapa aparece aqui.
        </Empty>
      ) : (
        <>
          <section aria-label="Resumo" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {tiles.map(([k, v, hint]) => (
              <div key={k} className="rounded-3xl border border-line bg-surface p-4 shadow-card">
                <p className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{k}</p>
                <p className="num mt-1 text-[28px] leading-none font-bold tracking-[-0.03em]">{v}</p>
                <p className="mt-1.5 text-[12px] text-ink-3">{hint}</p>
              </div>
            ))}
          </section>

          <section className="mb-6 rounded-3xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-[17px] font-bold">Onde falta imóvel</h2>
            <p className="mb-3 text-[13px] text-ink-3">Os perfis mais procurados (bairro e tipo) e quantos imóveis assim existem hoje no site.</p>
            {d.segments.length === 0 ? (
              <p className="text-[14px] text-ink-3">Os pedidos do período ainda não têm bairro preenchido.</p>
            ) : (
              <Suspense fallback={<p className="text-[14px] text-ink-3">Conferindo a oferta no site…</p>}>
                <Gaps actor={actor} segments={d.segments} days={days} />
              </Suspense>
            )}
          </section>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Bars title="Bairros mais pedidos" items={d.byArea} empty="Nenhum pedido com bairro no período." />
            <Bars title="Tipo de imóvel" items={d.byType} />
            <Bars title="Quartos" items={d.byBedrooms} empty="Nenhum pedido com quartos no período." />
            <Bars title="Valor máximo (total)" items={d.byBudget} empty="Nenhum pedido com valor no período." />
          </div>
          <Bars title="Como terminaram os pedidos do radar" items={c.outcomes} empty="Nenhum pedido do radar encerrado no período." />
          <p className="mt-4 text-[12px] text-ink-3">
            Base: {d.total} pedidos ({d.withProfile} com perfil preenchido) criados nos últimos {days} dias ou ainda em aberto. Um pedido com vários bairros conta em cada um.
          </p>
        </>
      )}
    </>
  );
}
