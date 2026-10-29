"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { captureOwnerAction } from "@/app/actions/capture";
import { cx } from "./ui";

/** "Estou buscando" (pega o pedido) / "Parar de buscar". `big`: botão principal da tela do pedido. */
export function CaptureOwnerButton({ id, mine, taken, big }: { id: string; mine: boolean; taken: boolean; big?: boolean }) {
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
      <button type="button" disabled={pending} onClick={() => go(false)} className="press inline-flex min-h-10 items-center text-[14px] font-semibold text-ink-2 hover:text-ink disabled:opacity-50">
        Parar de buscar
      </button>
    );
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => go(true)}
        className={cx("press inline-flex items-center justify-center font-semibold disabled:opacity-50", big ? "min-h-12 w-full rounded-full bg-accent px-6 text-[16px] text-white shadow-float" : "min-h-10 rounded-full border border-accent/50 px-4 text-[14px] text-accent-strong")}
      >
        {pending ? "Salvando…" : taken ? "Assumir: estou buscando" : "Estou buscando"}
      </button>
      {err && <p className="mt-1 text-[12px] font-semibold text-bad">{err}</p>}
    </>
  );
}
