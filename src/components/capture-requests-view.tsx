import Link from "next/link";
import type { captureRequests } from "@/server/demand";
import type { captureScoreboard, Outcome } from "@/server/capture";
import { Empty, PageHeader, Segmented, cx } from "@/components/ui";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export type CaptureRow = Awaited<ReturnType<typeof captureRequests>>[number];
type Board = Awaited<ReturnType<typeof captureScoreboard>>;
export type CaptureTab = "buscar" | "meus" | "indicados" | "encerrados";

export const pedidoTitle = (r: Pick<CaptureRow, "propertyType" | "bedrooms" | "maxBudgetCents">) =>
  [r.propertyType ?? "Imóvel", r.bedrooms ? `${r.bedrooms}+ qtos` : null, r.maxBudgetCents ? `até ${brl(r.maxBudgetCents)}` : null].filter(Boolean).join(" · ");

const STEP_TONE = { bad: "text-bad", warn: "text-warn", good: "text-good", accent: "text-accent-strong", neutral: "text-ink-2" } as const;
const DOT = { bad: "bg-bad", warn: "bg-warn", good: "bg-good", accent: "bg-accent", neutral: "bg-ink-3" } as const;
const RANK: Record<Outcome, number> = { RENTED: 0, VISIT_SCHEDULED: 1, VISITED_LIKED: 2, VISITED_UNDECIDED: 3, VISITED_DISLIKED: 4, REJECTED: 5, OFFERED: 6 };

/** O próximo passo do pedido em uma frase (o que o captador precisa saber na lista). */
export function nextStep(r: CaptureRow, actorId: string, options: number | null): { text: string; tone: keyof typeof STEP_TONE } {
  if (r.status === "CLOSED") return { text: r.closeReason ?? "Encerrado", tone: "neutral" };
  if (r.status === "FOUND" && r.results.length) {
    const best = [...r.results].sort((a, b) => RANK[a.outcome] - RANK[b.outcome])[0];
    if (best.outcome === "RENTED") return { text: `${best.code}: alugou! 🎉`, tone: "good" };
    if (best.outcome === "VISIT_SCHEDULED") return { text: `${best.code}: visita marcada${best.detail ? ` ${best.detail}` : ""}`, tone: "good" };
    if (best.outcome === "VISITED_LIKED") return { text: `${best.code}: visitou e gostou`, tone: "good" };
    if (best.outcome === "VISITED_UNDECIDED") return { text: `${best.code}: visitou, está decidindo`, tone: "warn" };
    if (best.outcome === "VISITED_DISLIKED") return { text: `Não gostou de ${best.code}${best.detail ? ` (${best.detail.toLowerCase()})` : ""}: indique outro`, tone: "bad" };
    if (best.outcome === "REJECTED") return { text: "Fora do perfil: indique outro", tone: "bad" };
    return { text: `Indicado ${r.results.map((x) => x.code).join(", ")}: aguardando o cliente`, tone: "neutral" };
  }
  const opt = options ? ` · ${options} opç${options === 1 ? "ão" : "ões"} no site` : "";
  if (r.captureOwnerId === actorId) return { text: `Você está buscando${opt}`, tone: "accent" };
  if (r.captureOwner) return { text: `${r.captureOwner.name.split(" ")[0]} está buscando${opt}`, tone: "neutral" };
  return { text: `Ninguém buscando${opt}`, tone: "bad" };
}

export function tabOf(r: CaptureRow, actorId: string): CaptureTab {
  if (r.status === "CLOSED") return "encerrados";
  if (r.status === "FOUND") return "indicados";
  return r.captureOwnerId === actorId ? "meus" : "buscar";
}

/** Lista enxuta: abas pelo que fazer, um cartão de duas linhas e o próximo passo. O resto fica na tela do pedido. */
export function CaptureRequestsView({ rows, actorId, board, tab, options, showMine }: { rows: CaptureRow[]; actorId: string; board: Board; tab: CaptureTab; options: Map<string, number>; showMine: boolean }) {
  const groups: Record<CaptureTab, CaptureRow[]> = { buscar: [], meus: [], indicados: [], encerrados: [] };
  for (const r of rows) groups[showMine ? tabOf(r, actorId) : tabOf(r, actorId) === "meus" ? "buscar" : tabOf(r, actorId)].push(r);
  const tabs: [CaptureTab, string][] = [["buscar", "Para buscar"], ...(showMine ? ([["meus", "Meus"]] as [CaptureTab, string][]) : []), ["indicados", "Indicados"], ["encerrados", "Encerrados"]];
  const list = groups[tab];
  const me = board.people.find((p) => p.id === actorId);
  const score = me ?? board.total;
  return (
    <>
      <PageHeader title="Pedidos" />
      {(score.indicated > 0 || board.people.length > 0) && (
        <p className="-mt-4 mb-4 text-[13px] text-ink-2">
          <span className="font-semibold capitalize">{board.label}</span>
          {me ? "" : " (equipe)"}: <span className="num font-semibold">{score.indicated}</span> indicado{score.indicated === 1 ? "" : "s"} · <span className="num font-semibold">{score.visits}</span> visita{score.visits === 1 ? "" : "s"} ·{" "}
          <span className="num font-semibold">{score.rented}</span> alugado{score.rented === 1 ? "" : "s"}
        </p>
      )}
      <div className="mb-4">
        <Segmented label="Pedidos" items={tabs.map(([k, label]) => ({ href: `/demanda/pedidos?aba=${k}`, label: `${label} ${groups[k].length ? groups[k].length : ""}`.trim(), active: tab === k }))} />
      </div>
      {list.length === 0 ? (
        <Empty title={tab === "buscar" ? "Nada para buscar agora" : tab === "meus" ? "Você não está buscando nenhum pedido" : tab === "indicados" ? "Nenhum pedido com imóvel indicado" : "Nenhum pedido encerrado nos últimos 30 dias"} icon="✓">
          {tab === "buscar" ? "Quando o atendimento passar um pedido, ele aparece aqui e você recebe um aviso." : tab === "meus" ? "Abra um pedido em “Para buscar” e toque em “Estou buscando”." : null}
        </Empty>
      ) : (
        <ul className="grid gap-2.5 lg:grid-cols-2">
          {list.map((r) => {
            const step = nextStep(r, actorId, options.get(r.id) ?? null);
            const late = r.status === "SEARCHING" && r.days >= 15;
            return (
              <li key={r.id} className="min-w-0">
                <Link href={`/demanda/pedidos/${r.id}`} className={cx("press block rounded-2xl border bg-surface p-3.5 shadow-card", late ? "border-bad/40" : "border-line")}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[15px] font-bold">{pedidoTitle(r)}</span>
                    <span className={cx("shrink-0 text-[12px]", late ? "font-semibold text-bad" : "text-ink-3")}>{r.days === 0 ? "hoje" : `há ${r.days} d`}</span>
                  </span>
                  <span className="block truncate text-[13px] text-ink-2">{r.areas.join(", ") || "Sem bairro"}</span>
                  <span className={cx("mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold", STEP_TONE[step.tone])}>
                    <span aria-hidden className={cx("size-2 shrink-0 rounded-full", DOT[step.tone])} />
                    <span className="min-w-0 flex-1 truncate">{step.text}</span>
                    <span aria-hidden className="text-ink-3">›</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
