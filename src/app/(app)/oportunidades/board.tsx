"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEAL_STAGES, FELL_LABEL, FOLLOW_UP_LABEL, STAGE_LABEL } from "@/lib/deal-stages";
import { cx } from "@/components/ui";

export type BoardCard = { id: string; version: number; column: string; client: string; property: string; responsible: string | null; visits: number; idleDays: number; stale: boolean; photoUrl: string | null };

const COLUMNS: { key: string; label: string; bar: string }[] = [
  { key: "FOLLOW", label: FOLLOW_UP_LABEL, bar: "bg-ink-3" },
  ...DEAL_STAGES.map((s, i) => ({ key: s as string, label: STAGE_LABEL[s], bar: i >= 6 ? "bg-good" : i >= 4 ? "bg-accent" : "bg-[#2f6fde]" })),
  { key: "FELL", label: FELL_LABEL, bar: "bg-bad" },
];

/** Quadro do fluxo: uma coluna por situação. Mover (arrastar ou "Mover para…") abre o formulário da etapa. */
export function Board({ cards }: { cards: BoardCard[] }) {
  const router = useRouter();
  const [over, setOver] = useState<string | null>(null);
  const move = (card: BoardCard, to: string) => {
    if (to === card.column || to === "FOLLOW") return;
    router.push(`/oportunidades/${card.id}?para=${to}`);
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
      <div className="grid min-w-[2200px] grid-cols-10 gap-3">
        {COLUMNS.map((col) => {
          const list = cards.filter((c) => c.column === col.key);
          return (
            <section
              key={col.key}
              aria-label={col.label}
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
              <h2 className="mb-3 flex items-start justify-between gap-2 px-1 text-[13px] leading-snug font-bold">
                <span className="flex items-start gap-2">
                  <span aria-hidden className={cx("mt-1 size-2.5 shrink-0 rounded-full", col.bar)} />
                  {col.label}
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
                      <p className="leading-snug font-semibold">{c.client}</p>
                      <p className="text-[13px] text-ink-3">Imóvel {c.property}</p>
                      <p className="text-[12px] text-ink-3">{c.responsible ?? "sem responsável"}</p>
                      {c.stale && <p className="mt-1.5 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent-strong">Parado há {c.idleDays} dias</p>}
                    </Link>
                    <label className="mt-2 block pl-1.5">
                      <span className="sr-only">Mover {c.client} para</span>
                      <select value="" onChange={(e) => e.target.value && move(c, e.target.value)} className="min-h-9 w-full rounded-xl border border-line bg-surface-2 px-2 text-[13px] text-ink-2">
                        <option value="">Mover para…</option>
                        {COLUMNS.filter((x) => x.key !== c.column && x.key !== "FOLLOW").map((x) => (
                          <option key={x.key} value={x.key}>
                            {x.label}
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
  );
}
