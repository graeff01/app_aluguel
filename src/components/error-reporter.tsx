"use client";
import { useEffect } from "react";

export function reportClientError(message: string, stack?: string) {
  try {
    if (/^Script error\.?$|ResizeObserver|Failed to execute .measure.|Load failed|NetworkError|Failed to fetch/i.test(message)) return; // ruído conhecido
    fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "visitas" },
      body: JSON.stringify({ message: message.slice(0, 500), path: location.pathname, stack: stack?.slice(0, 500) }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {}
}

/** Captura erros não tratados no navegador. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError(e.message || "Erro de script", e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => reportClientError(String((e.reason as Error)?.message ?? e.reason), (e.reason as Error)?.stack);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
