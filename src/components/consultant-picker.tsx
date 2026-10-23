"use client";
import { useState } from "react";
import { cx } from "@/components/ui";

export type QueueItem = { id: string; name: string; away: boolean; awayUntil: string | null; lastAt: Date | null; monthCount: number; openCount: number; isNext: boolean; isLast: boolean };

const ago = (d: Date) => {
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
};

/** Escolha da consultora pelo rodízio (pré-análise e proposta dividem a mesma vez). */
export function ConsultantPicker({ consultants, error }: { consultants: QueueItem[]; error?: string }) {
  const [chosen, setChosen] = useState(consultants.find((c) => c.isNext)?.id ?? "");
  const [own, setOwn] = useState(false);
  return (
    <fieldset className="mb-5">
      <legend className="mb-1 text-sm font-semibold text-ink">Encaminhar para a consultora</legend>
      <p className="mb-3 text-[13px] text-ink-3">Rodízio: a da vez é quem recebeu há mais tempo (pré-análise ou proposta). Toque em outra se precisar.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {consultants.map((c) => {
          const on = chosen === c.id;
          return (
            <label
              key={c.id}
              className={cx(
                "press relative flex cursor-pointer items-center gap-3 rounded-[22px] border-2 bg-surface p-4 transition",
                on ? "border-accent shadow-[0_10px_24px_-14px_var(--accent)]" : "border-line hover:border-line-strong",
              )}
            >
              <input type="radio" name="consultantId" value={c.id} checked={on} onChange={() => setChosen(c.id)} className="sr-only" required />
              <span className={cx("grid size-12 shrink-0 place-items-center rounded-full text-[15px] font-bold", on ? "bg-accent text-white" : "bg-tint text-ink")}>
                {c.name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-bold">{c.name}</span>
                <span className="block text-[12px] text-ink-3">
                  {c.lastAt ? `Recebeu ${ago(c.lastAt)}` : "Ainda não recebeu"} · {c.openCount ? `${c.openCount} em aberto` : "nada em aberto"} · {c.monthCount} no mês
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.isNext && <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-white">Próxima da vez</span>}
                  {c.isLast && <span className="rounded-full bg-tint px-2.5 py-0.5 text-[11px] font-bold text-ink-2">Última a receber</span>}
                  {c.away && <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] font-bold text-warn">Ausente até {c.awayUntil}</span>}
                </span>
              </span>
              <span aria-hidden className={cx("grid size-6 shrink-0 place-items-center rounded-full border-2", on ? "border-accent bg-accent text-white" : "border-line-strong")}>
                {on && (
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3}>
                    <path d="M5 12.5l4.5 4.5L19 7" />
                  </svg>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-[13px] font-semibold text-bad">{error}</p>}
      {chosen && !own && !consultants.find((c) => c.id === chosen)?.isNext && <p className="mt-2 text-[13px] font-semibold text-accent-strong">Fora do rodízio: pela vez, seria {consultants.find((c) => c.isNext)?.name.split(" ")[0]}.</p>}
      <label className={cx("mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-[14px]", own ? "border-accent bg-accent-soft/50" : "border-line")}>
        <input type="checkbox" name="ownClient" value="1" checked={own} onChange={(e) => setOwn(e.target.checked)} className="mt-0.5 size-5 accent-[var(--accent)]" />
        <span>
          <strong>Cliente já é de {consultants.find((c) => c.id === chosen)?.name.split(" ")[0] ?? "uma consultora"}</strong>
          <span className="block text-[12px] text-ink-3">Vai para ela sem contar a vez: o rodízio continua como estava.</span>
        </span>
      </label>
    </fieldset>
  );
}
