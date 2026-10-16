"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoCancelAction } from "@/app/actions/visits";
import { GOOGLE_CANCEL_TEXT } from "@/lib/cancel-messages";

const SECONDS = 15;

/** Depois de cancelar: o resultado e "Desfazer" por alguns segundos (clique errado). */
export function UndoCancel({ undoId, count, google, back }: { undoId: string; count: number; google: string; back: string }) {
  const router = useRouter();
  const [left, setLeft] = useState(SECONDS);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (msg || left <= 0) return;
    const t = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left, msg]);
  useEffect(() => {
    if (left === 0 && !msg) router.replace(back, { scroll: false });
  }, [left, msg, back, router]);

  const head = msg ?? `${count > 1 ? `Visita cancelada (${count} imóveis).` : "Visita cancelada."} A consultora foi avisada. ${GOOGLE_CANCEL_TEXT[google] ?? ""}`;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-[14px] text-bg">
      <span className="min-w-0 flex-1">{head}</span>
      {!msg && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await undoCancelAction(undoId);
              setMsg(r.message ?? (r.ok ? "Cancelamento desfeito." : "Não foi possível desfazer."));
              if (r.ok) setTimeout(() => router.replace(back, { scroll: false }), 2500);
            })
          }
          className="press min-h-10 shrink-0 rounded-full bg-bg px-4 text-[13px] font-bold text-ink"
        >
          {pending ? "Desfazendo…" : `Desfazer (${left})`}
        </button>
      )}
    </div>
  );
}
