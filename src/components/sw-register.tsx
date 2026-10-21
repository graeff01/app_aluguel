"use client";
import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.pathname.startsWith("/d/")) return; // link do cliente: não instala o app da equipe
    const secure = window.location.protocol === "https:" || window.location.hostname === "localhost";
    if (secure) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
