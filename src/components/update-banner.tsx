"use client";
import { useEffect, useState } from "react";

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/** Depois de uma publicação, o app aberto (principalmente instalado) avisa para atualizar — sem interromper. */
export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (BUILD === "dev") return;
    let last = 0;
    const check = async () => {
      if (Date.now() - last < 60_000 || !navigator.onLine) return;
      last = Date.now();
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { version } = (await r.json()) as { version: string };
        if (version && version !== "dev" && version !== BUILD) setStale(true);
      } catch {}
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(check, 10 * 60_000);
    check();
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, []);
  if (!stale) return null;
  return (
    <div role="status" className="pb-safe fixed inset-x-0 top-0 z-40 flex justify-center px-3 pt-2">
      <div className="animate-rise flex items-center gap-3 rounded-full border border-line bg-surface/95 py-1.5 pr-1.5 pl-4 text-[13px] font-semibold shadow-float backdrop-blur">
        Nova versão disponível
        <button type="button" onClick={() => location.reload()} className="press min-h-9 rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary">
          Atualizar
        </button>
      </div>
    </div>
  );
}
