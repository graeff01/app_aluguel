import type { ReactNode } from "react";
import type { captureRequests } from "@/server/demand";
import { brl } from "@/server/proposals";
import { marketLine } from "@/server/market";
import { fmt } from "@/lib/time";
import { Empty, PageHeader, cx } from "@/components/ui";

export type CaptureRow = Awaited<ReturnType<typeof captureRequests>>[number];

/** Pedidos em aberto para a captação (o mesmo na tela real e na demonstração). */
export function CaptureRequestsView({ rows, renderFound, renderMarket }: { rows: CaptureRow[]; renderFound: (id: string) => ReactNode; renderMarket: (r: CaptureRow) => ReactNode }) {
  const waiting = rows.filter((r) => r.status === "SEARCHING");
  const found = rows.filter((r) => r.status === "FOUND");
  const card = (r: (typeof rows)[number]) => (
    <li key={r.id} className={cx("rounded-3xl border bg-surface p-4 shadow-card", r.status === "SEARCHING" && r.days >= 15 ? "border-bad/40" : "border-line")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[15px] font-bold">
          {[r.propertyType ?? "Imóvel", r.bedrooms ? `${r.bedrooms}+ quartos` : null].filter(Boolean).join(" · ")}
          {r.maxBudgetCents ? <span className="font-semibold text-ink-2"> · até {brl(r.maxBudgetCents)}</span> : null}
        </p>
        <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold", r.status === "FOUND" ? "bg-good-soft text-good" : r.days >= 15 ? "bg-bad-soft text-bad" : "bg-accent-soft text-accent-strong")}>
          {r.status === "FOUND" ? "Imóvel indicado" : r.days === 0 ? "Pedido de hoje" : `Há ${r.days} dia${r.days === 1 ? "" : "s"}`}
        </span>
      </div>
      {r.areas.length > 0 && <p className="mt-0.5 text-[14px] font-semibold text-ink-2">{r.areas.join(", ")}</p>}
      <p className="mt-2 rounded-2xl bg-tint px-3 py-2 text-[14px] whitespace-pre-wrap">“{r.wants}”</p>
      <p className="mt-2 text-[12px] text-ink-3">
        Pedido de {r.createdBy.name.split(" ")[0]} · passado à captação em {fmt.shortDate(r.sentToCaptureAt!)}
        {r.foundCodes.length ? ` · já indicados: ${r.foundCodes.join(", ")}` : ""}
      </p>
      {r.marketTag && (
        <p className="mt-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[13px]">
          <strong>Parecer da captação:</strong> {marketLine({ tag: r.marketTag, text: r.marketNote, cents: r.marketCents })}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        {renderFound(r.id)}
        {renderMarket(r)}
      </div>
    </li>
  );
  return (
    <>
      <PageHeader title="Pedidos em aberto" subtitle="O que os clientes procuram e não encontramos na base. Achou um imóvel com o perfil? Indique: o pré-atendimento é avisado na hora para oferecer ao cliente." />
      {rows.length === 0 ? (
        <Empty title="Nenhum pedido em aberto" icon="✓">
          Quando o pré-atendimento passar um pedido para a captação, ele aparece aqui e você recebe um aviso.
        </Empty>
      ) : (
        <>
          <h2 className="mb-3 text-[15px] font-bold">
            Esperando imóvel <span className="font-medium text-ink-3">· {waiting.length}</span>
          </h2>
          {waiting.length === 0 ? <p className="mb-6 text-[14px] text-ink-3">Todos os pedidos já têm imóvel indicado.</p> : <ul className="mb-8 grid gap-3 lg:grid-cols-2">{waiting.map(card)}</ul>}
          {found.length > 0 && (
            <>
              <h2 className="mb-3 text-[15px] font-bold">
                Com imóvel indicado, aguardando o cliente <span className="font-medium text-ink-3">· {found.length}</span>
              </h2>
              <ul className="grid gap-3 lg:grid-cols-2">{found.map(card)}</ul>
            </>
          )}
        </>
      )}
      <p className="mt-6 text-[12px] text-ink-3">Por proteção de dados, nome e telefone do cliente não aparecem para a captação.</p>
    </>
  );
}
