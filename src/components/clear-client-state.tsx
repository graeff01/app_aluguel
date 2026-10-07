"use client";
import { useEffect } from "react";

/** Ao sair: limpa armazenamento do navegador e caches do service worker. */
export function ClearClientState() {
  useEffect(() => {
    try {
      sessionStorage.clear();
      localStorage.clear();
    } catch {}
    if ("caches" in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => undefined);
    navigator.serviceWorker?.controller?.postMessage({ type: "LOGOUT" });
    // aparelho deixa de receber lembretes da conta que saiu (servidor apaga a inscrição no próximo envio)
    navigator.serviceWorker?.ready
      .then((reg) => reg.pushManager?.getSubscription())
      .then((sub) => sub?.unsubscribe())
      .catch(() => undefined);
  }, []);
  return null;
}
