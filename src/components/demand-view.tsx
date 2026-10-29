import { Suspense } from "react";
import type { demandMap, segmentSupply } from "@/server/demand";
import { captureBrief, type SegmentNote } from "@/server/demand";
import { marketLine, noteForSegment } from "@/server/market";
import { MARKET_TONE, type MarketTag } from "@/lib/market-tags";
import { MarketNoteForm } from "./market-note-form";
import { brl } from "@/server/proposals";
import { Empty, Segmented, cx } from "@/components/ui";
import { BriefActions } from "./brief-actions";

export type DemandData = Awaited<ReturnType<typeof demandMap>>;
export type SupplyRow = Awaited<ReturnType<typeof segmentSupply>>[number];

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

const TONE = { bad: "border-bad/30 bg-bad-soft", warn: "border-warn/30 bg-warn-soft", good: "border-good/30 bg-good-soft" } as const;

/** Leitura de mercado da captação para o perfil da linha (+ formulário para escrever/atualizar). */
function SegmentMarket({ r, notes, write }: { r: SupplyRow; notes: SegmentNote[]; write: boolean }) {
  const n = noteForSegment(notes, r.area, r.type);
  if (!n && !write) return null;
  return (
    <div className="mt-2">
      {n && (
        <p className={cx("rounded-xl border px-2.5 py-1.5 text-[12px] text-ink-2", TONE[MARKET_TONE[n.tag as MarketTag] ?? "warn"])}>
          <strong>Leitura da captação:</strong> {marketLine(n)}
          {n.author ? <span className="text-ink-3"> · {n.author}</span> : null}
        </p>
      )}
      {write && (
        <MarketNoteForm
          hidden={{ area: r.area, type: r.type ?? "" }}
          label={n ? "Atualizar leitura de mercado" : "Escrever leitura de mercado"}
          initial={n ? { tag: n.tag, text: n.text, cents: n.cents } : undefined}
        />
      )}
    </div>
  );
}

async function Gaps({ loadRows, days, notes, write }: { loadRows: () => Promise<SupplyRow[]>; days: number; notes: SegmentNote[]; write: boolean }) {
  const rows = await loadRows();
  const brief = captureBrief(days, rows, notes);
  return (
    <>
      {/* celular: um cartão por perfil */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((r) => (
          <li key={`${r.area}|${r.type}`} className="rounded-2xl border border-line p-3">
            <p className="font-semibold">
              {r.type ?? "Qualquer tipo"} · {r.area}
            </p>
            <p className="text-[12px] text-ink-3">{[r.bedrooms ? `${r.bedrooms}+ quartos` : null, r.budgetCents ? `até ${brl(r.budgetCents)}` : null].filter(Boolean).join(" · ") || "—"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              <span>
                <strong className="num">{r.demand}</strong> cliente{r.demand === 1 ? "" : "s"}
              </span>
              <span className="text-ink-3">·</span>
              {r.supply == null ? (
                <span className="text-ink-3">site não respondeu</span>
              ) : (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  <strong className="num">{r.supply}</strong> no site
                </a>
              )}
              {r.gap && <span className={cx("ml-auto inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-bold", GAP[r.gap].cls)}>{GAP[r.gap].label}</span>}
            </div>
            <SegmentMarket r={r} notes={notes} write={write} />
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
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
                  <SegmentMarket r={r} notes={notes} write={write} />
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
      <p className="mt-2 text-[12px] text-ink-3">“No site hoje”: imóveis no site com o mesmo bairro, tipo, quartos mínimos e aluguel até o valor mais pedido. Toque no número para ver a busca no site.{write ? " A leitura de mercado que a captação escreve aparece no resumo, nos pedidos e para as consultoras com clientes desse perfil." : ""}</p>
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

/** Mapa da demanda: período, resumo, onde falta imóvel e gráficos. */
export function DemandView({ d, days, basePath, loadRows, notes = [], write = false }: { d: DemandData; days: number; basePath: string; loadRows: () => Promise<SupplyRow[]>; notes?: SegmentNote[]; write?: boolean }) {
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
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Período"
          items={[30, 90, 180].map((n) => ({ href: `${basePath}?dias=${n}`, label: `${n} dias`, active: days === n }))}
        />
        <a href={`${basePath}/pedidos`} className="press inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 text-[13px] font-semibold">
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
                <Gaps loadRows={loadRows} days={days} notes={notes} write={write} />
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
