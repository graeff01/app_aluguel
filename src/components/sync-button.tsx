"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncButton() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const router = useRouter();
  async function run() {
    setState("busy");
    setMsg("");
    try {
      const r = await fetch("/api/sync", { method: "POST", headers: { "x-requested-with": "visitas" } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setState("error");
        setMsg(data.message ?? "Não foi possível solicitar.");
        return;
      }
      setState("done");
      setMsg("Sincronização solicitada. Os dados aparecem em instantes.");
      setTimeout(() => router.refresh(), 20_000);
    } catch {
      setState("error");
      setMsg("Sem conexão.");
    }
  }
  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={run}
        disabled={state === "busy"}
        className="inline-flex min-h-12 items-center gap-2 rounded-full border border-line-strong bg-surface px-5 text-[15px] font-semibold shadow-card transition hover:border-ink-3 disabled:opacity-50"
      >
        {state === "busy" ? "Solicitando…" : "Sincronizar agora"}
      </button>
      {msg && (
        <p role="status" className={`mt-1 max-w-56 text-right text-xs ${state === "error" ? "text-bad" : "text-ink-3"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}
