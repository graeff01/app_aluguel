"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moveOpportunityAction } from "@/app/actions/manager";
import { OPP_STATUS_LABEL } from "@/lib/labels";
import { cx } from "@/components/ui";

export type BoardCard = { id: string; version: number; status: string; client: string; property: string; responsible: string | null; visits: number; idleDays: number; stale: boolean; photoUrl: string | null };

const COLUMNS = [
  { key: "FOLLOW_UP", bar: "bg-[#2f6fde]" },
  { key: "DOCS_REVIEW", bar: "bg-accent" },
  { key: "CLOSED_WON", bar: "bg-good" },
  { key: "LOST", bar: "bg-bad" },
] as const;

/** Quadro de andamento: arrastar (desktop) ou "Mover para…" (celular/teclado). Fechar/perder abre o formulário completo. */
export function Board({ cards }: { cards: BoardCard[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [over, setOver] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  function move(card: BoardCard, to: string) {
    if (to === card.status) return;
    if (to === "CLOSED_WON" || to === "LOST" || card.status === "CLOSED_WON" || card.status === "LOST") {
      router.push(`/oportunidades/${card.id}?para=${to}`);
      return;
    }
    start(async () => {
      const fd = new FormData();
      fd.set("oppId", card.id);
      fd.set("version", String(card.version));
      fd.set("toStatus", to);
      const r = await moveOpportunityAction({ ok: false }, fd);
      setMsg(r.ok ? `${card.client} movido para ${OPP_STATUS_LABEL[to]}.` : (r.message ?? "Não foi possível mover."));
      router.refresh();
    });
  }

  return (
    <>
      <p role="status" className="sr-only">
        {msg}
      </p>
      <div className={cx("-mx-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0", pending && "opacity-70")}>
        <div className="grid min-w-[960px] grid-cols-4 gap-4">
          {COLUMNS.map((col) => {
            const list = cards.filter((c) => c.status === col.key);
            return (
              <section
                key={col.key}
                aria-label={OPP_STATUS_LABEL[col.key]}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(col.key);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const card = cards.find((c) => c.id === e.dataTransfer.getData("text/plain"));
                  if (card) move(card, col.key);
                }}
                className={cx("flex min-h-64 flex-col rounded-3xl border bg-surface-2 p-3 transition-colors", over === col.key ? "border-accent bg-accent-soft" : "border-line")}
              >
                <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-bold">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={cx("size-2.5 rounded-full", col.bar)} />
                    {OPP_STATUS_LABEL[col.key]}
                  </span>
                  <span className="num rounded-full bg-tint px-2 text-[12px] text-ink-2">{list.length}</span>
                </h2>
                <ul className="flex flex-1 flex-col gap-2.5">
                  {list.map((c) => (
                    <li
                      key={c.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                      className="relative cursor-grab overflow-hidden rounded-2xl border border-line bg-surface p-3 shadow-card active:cursor-grabbing"
                    >
                      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-1", col.bar)} />
                      <Link href={`/oportunidades/${c.id}`} className="block pl-1.5">
                        <p className="font-semibold leading-snug">{c.client}</p>
                        <p className="text-[13px] text-ink-3">
                          Imóvel {c.property} · {c.visits} visita{c.visits === 1 ? "" : "s"}
                        </p>
                        <p className="text-[12px] text-ink-3">{c.responsible ?? "sem responsável"}</p>
                        {c.stale && <p className="mt-1.5 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent-strong">Parada há {c.idleDays} dias</p>}
                      </Link>
                      <label className="mt-2 block pl-1.5">
                        <span className="sr-only">Mover {c.client} para</span>
                        <select
                          value=""
                          onChange={(e) => e.target.value && move(c, e.target.value)}
                          className="min-h-9 w-full rounded-xl border border-line bg-surface-2 px-2 text-[13px] text-ink-2"
                        >
                          <option value="">Mover para…</option>
                          {COLUMNS.filter((x) => x.key !== c.status).map((x) => (
                            <option key={x.key} value={x.key}>
                              {OPP_STATUS_LABEL[x.key]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  ))}
                  {list.length === 0 && <li className="rounded-2xl border border-dashed border-line-strong p-4 text-center text-[13px] text-ink-3">Arraste para cá</li>}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
