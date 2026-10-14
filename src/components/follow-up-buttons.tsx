"use client";
import { useState, useTransition } from "react";
import { followUpDoneAction } from "@/app/actions/visits";

/** "Feito" / "Adiar 2 dias" de um retorno; some da lista ao concluir. */
export function FollowUpButtons({ visitId }: { visitId: string }) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<string | null>(null);
  const run = (a: "done" | "snooze") =>
    start(async () => {
      const r = await followUpDoneAction(visitId, a);
      if (r.ok) setGone(a === "done" ? "✓ Retorno feito" : "Adiado para daqui a 2 dias");
    });
  if (gone) return <span className="text-[13px] font-semibold text-good">{gone}</span>;
  return (
    <span className="flex gap-2">
      <button type="button" disabled={pending} onClick={() => run("done")} className="press min-h-10 rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary disabled:opacity-50">
        Feito
      </button>
      <button type="button" disabled={pending} onClick={() => run("snooze")} className="press min-h-10 rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-semibold disabled:opacity-50">
        Adiar 2 dias
      </button>
    </span>
  );
}
