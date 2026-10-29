import type { ReactNode } from "react";
import type { captureRequests } from "@/server/demand";
import { marketLine } from "@/server/market";
import { fmt } from "@/lib/time";
import { Empty, PageHeader, cx } from "@/components/ui";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export type CaptureRow = Awaited<ReturnType<typeof captureRequests>>[number];

/**
 * Pedidos para a captação: o que precisa de imóvel primeiro (com as opções do site para indicar) e, abaixo, o que
 * já foi indicado e espera o cliente. Sem nome nem telefone do cliente.
 */
export function CaptureRequestsView({ rows, renderFound, renderMarket, renderOptions }: { rows: CaptureRow[]; renderFound: (id: string) => ReactNode; renderMarket: (r: CaptureRow) => ReactNode; renderOptions: (r: CaptureRow) => ReactNode }) {
  const waiting = rows.filter((r) => r.status === "SEARCHING");
  const found = rows.filter((r) => r.status === "FOUND");
  const card = (r: CaptureRow) => {
    const late = r.status === "SEARCHING" && r.days >= 15;
    return (
      <li key={r.id} className={cx("min-w-0 rounded-3xl border bg-surface p-4 shadow-card", late ? "border-bad/40" : "border-line")}>
        <div className="flex items-center justify-between gap-2">
          {r.status === "FOUND" ? (
            <span className="rounded-full bg-good-soft px-2.5 py-0.5 text-[12px] font-bold text-good">Indicado: {r.foundCodes.join(", ")}</span>
          ) : (
            <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-bold", late ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent-strong")}>Precisa de imóvel</span>
          )}
          <span className={cx("text-[12px]", late ? "font-semibold text-bad" : "text-ink-3")}>{r.days === 0 ? "hoje" : `há ${r.days} dia${r.days === 1 ? "" : "s"}`}</span>
        </div>
        <p className="mt-2 text-[16px] font-bold">
          {[r.propertyType ?? "Imóvel", r.bedrooms ? `${r.bedrooms}+ qtos` : null, r.maxBudgetCents ? `até ${brl(r.maxBudgetCents)}` : null].filter(Boolean).join(" · ")}
        </p>
        {r.areas.length > 0 && <p className="text-[14px] text-ink-2">{r.areas.join(", ")}</p>}
        <p className="mt-0.5 text-[12px] text-ink-3">
          Pedido de {r.createdBy.name.split(" ")[0]} · {fmt.shortDate(r.sentToCaptureAt!).replace(".", "")}
        </p>
        <details className="group mt-2">
          <summary className="cursor-pointer list-none rounded-xl bg-tint px-3 py-2 text-[13px] text-ink-2">
            <span className="line-clamp-2 group-open:line-clamp-none">“{r.wants}”</span>
          </summary>
        </details>
        {r.marketTag && (
          <p className="mt-2 text-[12px] text-ink-2">
            <strong>Seu parecer:</strong> {marketLine({ tag: r.marketTag, text: r.marketNote, cents: r.marketCents })}
          </p>
        )}
        {r.status === "SEARCHING" && <div className="mt-3">{renderOptions(r)}</div>}
        <div className="flex flex-wrap items-start gap-x-3">
          {renderFound(r.id)}
          {renderMarket(r)}
        </div>
      </li>
    );
  };
  return (
    <>
      <PageHeader title="Pedidos" subtitle="Clientes que o atendimento ainda não conseguiu atender. Indique um imóvel e o pré-atendimento é avisado." />
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
                Você já indicou <span className="font-medium text-ink-3">· {found.length}</span>
              </h2>
              <p className="mb-3 text-[13px] text-ink-3">O atendimento está oferecendo ao cliente. Achou outro? Indique também.</p>
              <ul className="grid items-start gap-3 lg:grid-cols-2">{found.map(card)}</ul>
            </>
          )}
        </>
      )}
      <p className="mt-6 text-[12px] text-ink-3">Nome e telefone do cliente não aparecem para a captação (proteção de dados).</p>
    </>
  );
}
