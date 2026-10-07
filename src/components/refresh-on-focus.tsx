"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Atualiza os dados ao voltar para o app (no iPhone instalado não há "puxar para atualizar"). */
export function RefreshOnFocus({ minIntervalMs = 30_000 }: { minIntervalMs?: number }) {
  const router = useRouter();
  const last = useRef(Date.now());
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (Date.now() - last.current < minIntervalMs) return;
      last.current = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [router, minIntervalMs]);
  return null;
}
