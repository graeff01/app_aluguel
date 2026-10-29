import { Suspense } from "react";
import type { demandMap, segmentSupply } from "@/server/demand";
import { captureBrief, type SegmentNote } from "@/server/demand";
import { marketLine, noteForSegment } from "@/server/market";
import { MARKET_TONE, type MarketTag } from "@/lib/market-tags";
import { MarketNoteForm } from "./market-note-form";
import { ListingStrip, type StripPedido } from "./listing-strip";
import { normText } from "@/server/site-search";
import { Empty, Segmented, cx } from "@/components/ui";
import { BriefActions } from "./brief-actions";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export type DemandData = Awaited<ReturnType<typeof demandMap>>;
export type SupplyRow = Awaited<ReturnType<typeof segmentSupply>>[number];

/** Barras horizontais de uma série só (contagem), ordenadas; valor escrito ao lado e no toque/hover. */
function Bars({ title, items, unit = "pedido", empty }: { title: string; items: { label: string; count: number }[]; unit?: string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const shown = items.filter((i) => i.count > 0);
  return (
    <section className="rounded-2xl bg-surface-2 p-4">
      <h2 className="mb-3 text-[14px] font-bold">{title}</h2>
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
  none: { label: "Falta imóvel", cls: "bg-bad-soft text-bad" },
  low: { label: "Pouca oferta", cls: "bg-warn-soft text-warn" },
  ok: { label: "Tem no site", cls: "bg-good-soft text-good" },
} as const;

const TONE = { bad: "border-bad/30 bg-bad-soft", warn: "border-warn/30 bg-warn-soft", good: "border-good/30 bg-good-soft" } as const;

/** Pedido do radar com a captação (só o perfil), para indicar imóveis direto do mapa. */
export type MapPedido = { id: string; areas: string[]; propertyType: string | null; bedrooms: number | null; maxBudgetCents: number | null; foundCodes: string[] };

const pedidoLabel = (p: MapPedido) => [p.propertyType ?? "Imóvel", p.bedrooms ? `${p.bedrooms}+ qtos` : null, p.maxBudgetCents ? `até ${brl(p.maxBudgetCents)}` : null, p.areas.join(", ")].filter(Boolean).join(" · ");
const pedidosFor = (pedidos: MapPedido[], r: SupplyRow): StripPedido[] =>
  pedidos
    .filter((p) => p.areas.some((a) => normText(a) === normText(r.area)) && (!r.type || !p.propertyType || normText(p.propertyType) === normText(r.type)))
    .map((p) => ({ id: p.id, label: pedidoLabel(p), foundCodes: p.foundCodes }));

/** Um perfil procurado: demanda × oferta, os imóveis do site e a leitura de mercado. */
function Segment({ r, notes, write, pedidos }: { r: SupplyRow; notes: SegmentNote[]; write: boolean; pedidos: MapPedido[] }) {
  const n = noteForSegment(notes, r.area, r.type);
  const mine = pedidosFor(pedidos, r);
  return (
    <li className="min-w-0 rounded-2xl border border-line p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold">
            {r.type ?? "Imóvel"} · {r.area}
          </p>
          <p className="text-[13px] text-ink-3">
            <span className="num">{r.demand}</span> cliente{r.demand === 1 ? "" : "s"}
            {r.bedrooms ? ` · ${r.bedrooms}+ qtos` : ""}
            {r.budgetCents ? ` · até ${brl(r.budgetCents)}` : ""}
          </p>
        </div>
        {r.gap ? <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold", GAP[r.gap].cls)}>{GAP[r.gap].label}</span> : <span className="shrink-0 text-[12px] text-ink-3">site fora do ar</span>}
      </div>
      {n && (
        <p className={cx("mt-2 rounded-xl border px-2.5 py-1.5 text-[12px] text-ink-2", TONE[MARKET_TONE[n.tag as MarketTag] ?? "warn"])}>
          <strong>Mercado:</strong> {marketLine(n)}
        </p>
      )}
      {r.supply != null && r.supply > 0 && (
        <details className="group mt-2">
          <summary className="press inline-flex min-h-9 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-accent-strong">
            Ver {r.supply} no site <span className="transition group-open:rotate-90">›</span>
          </summary>
          <div className="mt-2">
            <ListingStrip items={r.items} pedidos={mine} moreUrl={r.supply > r.items.length ? r.url : undefined} />
          </div>
        </details>
      )}
      {write && <MarketNoteForm hidden={{ area: r.area, type: r.type ?? "" }} label={n ? "Editar leitura de mercado" : "+ Leitura de mercado"} initial={n ? { tag: n.tag, text: n.text, cents: n.cents } : undefined} compact />}
    </li>
  );
}

async function Gaps({ loadRows, days, notes, write, pedidos, showBrief }: { loadRows: () => Promise<SupplyRow[]>; days: number; notes: SegmentNote[]; write: boolean; pedidos: MapPedido[]; showBrief: boolean }) {
  const rows = await loadRows();
  // resumo para a gestão mandar à equipe de captação (para o próprio captador não faz sentido)
  const brief = showBrief ? captureBrief(days, rows, notes) : null;
  return (
    <>
      <ul className="grid items-start gap-2.5 lg:grid-cols-2">
        {rows.map((r) => (
          <Segment key={`${r.area}|${r.type}`} r={r} notes={notes} write={write} pedidos={pedidos} />
        ))}
      </ul>
      {brief && (
        <details className="mt-4 rounded-2xl border border-line bg-surface-2 p-3.5">
          <summary className="cursor-pointer text-[14px] font-bold">Resumo para enviar no WhatsApp</summary>
          <pre className="mt-2 mb-3 text-[13px] whitespace-pre-wrap text-ink-2" style={{ fontFamily: "inherit" }}>
            {brief}
          </pre>
          <BriefActions text={brief} />
        </details>
      )}
    </>
  );
}

/** Mapa da demanda: período, números do período, onde falta imóvel (com os imóveis do site) e gráficos. */
export function DemandView({ d, days, basePath, loadRows, notes = [], write = false, pedidos = [], requestsLink = false, showBrief = false }: { d: DemandData; days: number; basePath: string; loadRows: () => Promise<SupplyRow[]>; notes?: SegmentNote[]; write?: boolean; pedidos?: MapPedido[]; requestsLink?: boolean; showBrief?: boolean }) {
  const c = d.capture;
  const stats: [string, string, string][] = [
    [String(d.total), "clientes", `${d.radar} do radar · ${d.searches} das consultoras`],
    [String(d.open), "sem imóvel", "pedidos em aberto agora"],
    [String(c.waiting15), "há 15+ dias", "pedidos do radar esperando há mais de 15 dias"],
    [c.closed ? `${Math.round((c.solveRate ?? 0) * 100)}%` : "—", "resolvidos", c.closed ? `${c.solved} de ${c.closed} encerrados (agendou ou alugou)` : "nenhum encerrado no período"],
    [c.avgDaysToSolve != null ? `${c.avgDaysToSolve}d` : "—", "p/ resolver", "tempo médio do pedido até agendar ou alugar"],
  ];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Período" items={[30, 90, 180].map((n) => ({ href: `${basePath}?dias=${n}`, label: `${n} dias`, active: days === n }))} />
        {requestsLink && (
          <a href={`${basePath}/pedidos`} className="text-[13px] font-semibold text-ink-2 underline underline-offset-2">
            Pedidos em aberto →
          </a>
        )}
      </div>
      {d.total === 0 ? (
        <Empty title="Nenhum pedido no período" icon="◌">
          Os pedidos do radar e os clientes em busca aparecem aqui quando têm bairro, tipo, quartos ou valor.
        </Empty>
      ) : (
        <>
          <section aria-label="Números do período" className="mb-5 grid grid-cols-5 divide-x divide-line rounded-2xl border border-line bg-surface py-3 shadow-card">
            {stats.map(([v, k, hint]) => (
              <div key={k} className="min-w-0 px-1.5 text-center" title={hint}>
                <p className="num text-[20px] leading-tight font-bold tracking-[-0.02em] sm:text-[24px]">{v}</p>
                <p className="truncate text-[11px] text-ink-3 sm:text-[12px]">{k}</p>
              </div>
            ))}
          </section>

          <section className="mb-6">
            <h2 className="mb-2.5 text-[16px] font-bold">Onde falta imóvel</h2>
            {d.segments.length === 0 ? (
              <p className="text-[14px] text-ink-3">Os pedidos do período ainda não têm bairro.</p>
            ) : (
              <Suspense fallback={<p className="text-[14px] text-ink-3">Conferindo o site…</p>}>
                <Gaps loadRows={loadRows} days={days} notes={notes} write={write} pedidos={pedidos} showBrief={showBrief} />
              </Suspense>
            )}
          </section>

          <details className="group rounded-2xl border border-line bg-surface p-3.5 shadow-card">
            <summary className="cursor-pointer list-none text-[15px] font-bold">
              Gráficos do período <span className="text-ink-3 transition group-open:rotate-90">›</span>
            </summary>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <Bars title="Bairros mais pedidos" items={d.byArea} empty="Nenhum pedido com bairro no período." />
              <Bars title="Tipo de imóvel" items={d.byType} />
              <Bars title="Quartos" items={d.byBedrooms} empty="Nenhum pedido com quartos no período." />
              <Bars title="Valor máximo (total)" items={d.byBudget} empty="Nenhum pedido com valor no período." />
              <Bars title="Como terminaram os pedidos do radar" items={c.outcomes} empty="Nenhum pedido do radar encerrado no período." />
            </div>
          </details>
        </>
      )}
    </>
  );
}
