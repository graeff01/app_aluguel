import type { ReactNode } from "react";
import type { captureRequests } from "@/server/demand";
import type { captureScoreboard } from "@/server/capture";
import { OUTCOME_TONE, outcomeText } from "@/server/capture";
import { marketLine } from "@/server/market";
import { fmt } from "@/lib/time";
import { Empty, PageHeader, cx } from "@/components/ui";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const ROLE_SHORT: Record<string, string> = { PRE_SERVICE: "pré-atendimento", CONSULTANT: "consultora", MANAGER: "gestão", ADMIN: "gestão" };
const TONE_CLS = { neutral: "bg-tint text-ink-2", bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", good: "bg-good-soft text-good" } as const;

export type CaptureRow = Awaited<ReturnType<typeof captureRequests>>[number];
type Board = Awaited<ReturnType<typeof captureScoreboard>>;

/** Placar do mês: indicados → chegaram a visita → alugados, por captador. */
function Scoreboard({ board, actorId }: { board: Board; actorId: string }) {
  if (!board.people.length) return null;
  return (
    <section aria-label={`Placar de ${board.label}`} className="mb-6 rounded-2xl border border-line bg-surface p-3.5 shadow-card">
      <p className="mb-2 text-[14px] font-bold">Placar de {board.label}</p>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] tracking-wide text-ink-3 uppercase">
            <th className="pb-1 text-left font-semibold">Quem</th>
            <th className="pb-1 text-right font-semibold">Indicados</th>
            <th className="pb-1 text-right font-semibold">Visitas</th>
            <th className="pb-1 text-right font-semibold">Alugados</th>
          </tr>
        </thead>
        <tbody>
          {board.people.map((p) => (
            <tr key={p.id} className={cx("border-t border-line", p.id === actorId && "font-bold")}>
              <td className="py-1.5">{p.id === actorId ? "Você" : p.name.split(" ")[0]}</td>
              <td className="num py-1.5 text-right">{p.indicated}</td>
              <td className="num py-1.5 text-right">{p.visits}</td>
              <td className="num py-1.5 text-right">{p.rented}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Pedidos para a captação: o que precisa de imóvel primeiro (com as opções do site para indicar), o que já foi
 * indicado (com o retorno de cada imóvel) e o que terminou nos últimos 30 dias. Sem nome nem telefone do cliente.
 */
export function CaptureRequestsView({ rows, actorId, board, renderFound, renderMarket, renderOptions, renderOwner }: { rows: CaptureRow[]; actorId: string; board: Board; renderFound: (id: string) => ReactNode; renderMarket: (r: CaptureRow) => ReactNode; renderOptions: (r: CaptureRow) => ReactNode; renderOwner: (r: CaptureRow) => ReactNode }) {
  const waiting = rows.filter((r) => r.status === "SEARCHING");
  const found = rows.filter((r) => r.status === "FOUND");
  const closed = rows.filter((r) => r.status === "CLOSED");
  const results = (r: CaptureRow) =>
    r.results.length > 0 && (
      <ul className="mt-2 space-y-1">
        {r.results.map((x) => (
          <li key={x.code} className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="num font-semibold">{x.code}</span>
            <span className={cx("rounded-full px-2 py-0.5 text-[12px] font-semibold", TONE_CLS[OUTCOME_TONE[x.outcome]])}>{outcomeText(x)}</span>
          </li>
        ))}
      </ul>
    );
  const title = (r: CaptureRow) => [r.propertyType ?? "Imóvel", r.bedrooms ? `${r.bedrooms}+ qtos` : null, r.maxBudgetCents ? `até ${brl(r.maxBudgetCents)}` : null].filter(Boolean).join(" · ");
  const card = (r: CaptureRow) => {
    const late = r.status === "SEARCHING" && r.days >= 15;
    const mine = r.captureOwnerId === actorId;
    return (
      <li key={r.id} className={cx("min-w-0 rounded-3xl border bg-surface p-4 shadow-card", late ? "border-bad/40" : "border-line")}>
        <div className="flex items-center justify-between gap-2">
          {r.status === "FOUND" ? (
            <span className="rounded-full bg-good-soft px-2.5 py-0.5 text-[12px] font-bold text-good">Imóvel indicado</span>
          ) : (
            <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-bold", late ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent-strong")}>Precisa de imóvel</span>
          )}
          <span className={cx("text-[12px]", late ? "font-semibold text-bad" : "text-ink-3")}>{r.days === 0 ? "hoje" : `há ${r.days} dia${r.days === 1 ? "" : "s"}`}</span>
        </div>
        <p className="mt-2 text-[16px] font-bold">{title(r)}</p>
        {r.areas.length > 0 && <p className="text-[14px] text-ink-2">{r.areas.join(", ")}</p>}
        <p className="mt-0.5 text-[12px] text-ink-3">
          Pedido de {r.createdBy.name.split(" ")[0]} ({ROLE_SHORT[r.createdBy.role] ?? "atendimento"}) · {fmt.shortDate(r.sentToCaptureAt!).replace(".", "")}
        </p>
        {r.captureOwner && <p className={cx("mt-1 text-[13px] font-semibold", mine ? "text-accent-strong" : "text-ink-2")}>🔎 {mine ? "Você está buscando" : `${r.captureOwner.name.split(" ")[0]} está buscando`}</p>}
        <details className="group mt-2">
          <summary className="cursor-pointer list-none rounded-xl bg-tint px-3 py-2 text-[13px] text-ink-2">
            <span className="line-clamp-2 group-open:line-clamp-none">“{r.wants}”</span>
          </summary>
        </details>
        {r.marketTag && (
          <p className="mt-2 text-[12px] text-ink-2">
            <strong>Parecer:</strong> {marketLine({ tag: r.marketTag, text: r.marketNote, cents: r.marketCents })}
          </p>
        )}
        {results(r)}
        {r.status === "SEARCHING" && <div className="mt-3">{renderOptions(r)}</div>}
        <div className="flex flex-wrap items-start gap-x-3">
          {renderOwner(r)}
          {renderFound(r.id)}
          {renderMarket(r)}
        </div>
      </li>
    );
  };
  return (
    <>
      <PageHeader title="Pedidos" subtitle="Clientes que o atendimento ainda não conseguiu atender. Indique um imóvel e quem pediu é avisado." />
      <Scoreboard board={board} actorId={actorId} />
      {rows.length === 0 ? (
        <Empty title="Nenhum pedido em aberto" icon="✓">
          Quando o atendimento passar um pedido, ele aparece aqui e você recebe um aviso.
        </Empty>
      ) : (
        <>
          <h2 className="mb-3 text-[15px] font-bold">
            Precisam de imóvel <span className="font-medium text-ink-3">· {waiting.length}</span>
          </h2>
          {waiting.length === 0 ? <p className="mb-6 text-[14px] text-ink-3">Nada pendente: todos já têm imóvel indicado.</p> : <ul className="mb-8 grid items-start gap-3 lg:grid-cols-2">{waiting.map(card)}</ul>}
          {found.length > 0 && (
            <>
              <h2 className="mb-1 text-[15px] font-bold">
                Já indicados <span className="font-medium text-ink-3">· {found.length}</span>
              </h2>
              <p className="mb-3 text-[13px] text-ink-3">O retorno de cada imóvel aparece aqui (visita marcada, visitou, alugou). Achou outro? Indique também.</p>
              <ul className="mb-8 grid items-start gap-3 lg:grid-cols-2">{found.map(card)}</ul>
            </>
          )}
          {closed.length > 0 && (
            <details className="group">
              <summary className="mb-3 cursor-pointer list-none text-[15px] font-bold">
                Encerrados nos últimos 30 dias <span className="font-medium text-ink-3">· {closed.length}</span> <span className="text-ink-3 transition group-open:rotate-90">›</span>
              </summary>
              <ul className="grid items-start gap-2 lg:grid-cols-2">
                {closed.map((r) => (
                  <li key={r.id} className="min-w-0 rounded-2xl border border-line bg-surface p-3.5">
                    <p className="text-[14px] font-bold">{title(r)}</p>
                    <p className="text-[13px] text-ink-2">
                      {r.areas.join(", ")}
                      {r.closeReason ? ` · ${r.closeReason}` : ""}
                    </p>
                    {results(r)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <p className="mt-6 text-[12px] text-ink-3">Nome e telefone do cliente não aparecem para a captação (proteção de dados).</p>
    </>
  );
}
