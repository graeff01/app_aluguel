"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { captureOwnerAction } from "@/app/actions/capture";

/** "Estou buscando" (pega o pedido) / "Parar de buscar". */
export function CaptureOwnerButton({ id, mine, taken }: { id: string; mine: boolean; taken: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (take: boolean) =>
    start(async () => {
      const r = await captureOwnerAction(id, take);
      if (!r.ok) return setErr(r.message ?? "Não foi possível.");
      setErr(null);
      router.refresh();
    });
  if (mine)
    return (
      <button type="button" disabled={pending} onClick={() => go(false)} className="press mt-1 inline-flex min-h-9 items-center text-[13px] font-semibold text-ink-3 hover:text-ink disabled:opacity-50">
        Parar de buscar
      </button>
    );
  return (
    <>
      <button type="button" disabled={pending} onClick={() => go(true)} className="press mt-1 inline-flex min-h-9 items-center rounded-full border border-accent/50 px-3 text-[13px] font-semibold text-accent-strong disabled:opacity-50">
        {taken ? "Assumir: estou buscando" : "Estou buscando"}
      </button>
      {err && <p className="basis-full text-[12px] font-semibold text-bad">{err}</p>}
    </>
  );
}
