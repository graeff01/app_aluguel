"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const SECONDS = 5;

/** "Resultado salvo · Desfazer" por 5 segundos após o primeiro registro. */
export function UndoToast() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const token = sp.get("desfazer");
  const [left, setLeft] = useState(SECONDS);
  const [state, setState] = useState<"idle" | "busy" | "error" | "gone">("idle");

  useEffect(() => {
    if (!token) return;
    setLeft(SECONDS);
    setState("idle");
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [token]);

  useEffect(() => {
    if (token && left <= 0 && state === "idle") {
      setState("gone");
      const q = new URLSearchParams(sp.toString());
      q.delete("desfazer");
      router.replace(`${path}${q.size ? `?${q}` : ""}`, { scroll: false });
    }
  }, [left, token, state, sp, path, router]);

  if (!token || state === "gone") return null;
  const [visitId, requestId] = token.split(".");

  async function undo() {
    setState("busy");
    try {
      const r = await fetch(`/api/visits/${visitId}/undo`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "visitas" },
        body: JSON.stringify({ requestId }),
      });
      if (!r.ok) return setState("error");
      router.replace(`/visitas/${visitId}/registrar?desfeito=1`);
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 md:bottom-6">
      <div role="status" className="animate-rise pointer-events-auto relative flex w-full max-w-md items-center justify-between gap-3 overflow-hidden rounded-2xl bg-primary py-3 pr-2 pl-4 text-on-primary shadow-float">
        <span className="text-sm font-semibold">{state === "error" ? "Não foi possível desfazer." : "✓ Resultado salvo"}</span>
        {state !== "error" && (
          <button type="button" onClick={undo} disabled={state === "busy"} className="min-h-10 rounded-xl px-4 text-sm font-bold text-accent hover:bg-tint disabled:opacity-50">
            {state === "busy" ? "Desfazendo…" : `Desfazer (${Math.max(left, 0)})`}
          </button>
        )}
        <span aria-hidden className="absolute bottom-0 left-0 h-[3px] bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${(Math.max(left, 0) / SECONDS) * 100}%` }} />
      </div>
    </div>
  );
}
