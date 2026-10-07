"use client";
import { useCallback, useEffect, useState } from "react";
import { cx } from "./ui";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on" | "busy" | "error";

function b64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function usePush(publicKey: string | null) {
  const [state, setState] = useState<State>("loading");
  const refresh = useCallback(async () => {
    if (!publicKey) return setState("unsupported");
    if (isIos() && !isStandalone()) return setState("ios-install");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    setState(sub ? "on" : "off");
  }, [publicKey]);
  useEffect(() => {
    refresh().catch(() => setState("unsupported"));
  }, [refresh]);

  const enable = async () => {
    if (!publicKey) return;
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
      const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "visitas" }, body: JSON.stringify(sub.toJSON()) });
      setState(r.ok ? "on" : "error");
    } catch {
      setState("error");
    }
  };
  const disable = async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json", "x-requested-with": "visitas" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("error");
    }
  };
  return { state, enable, disable };
}

const HINT: Partial<Record<State, string>> = {
  "ios-install": "No iPhone, instale o app (Compartilhar → Adicionar à Tela de Início) e abra por lá para ativar.",
  denied: "Notificações bloqueadas para este site. Libere nas configurações do navegador.",
  unsupported: "Este navegador não recebe notificações.",
  error: "Não foi possível ativar agora. Tente de novo.",
};

/** Item do menu da conta. */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const { state, enable, disable } = usePush(publicKey);
  if (!publicKey || state === "loading") return null;
  const on = state === "on";
  return (
    <div className="px-3 py-2">
      <button
        type="button"
        onClick={on ? disable : enable}
        disabled={state === "busy" || state === "unsupported" || state === "ios-install" || state === "denied"}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl text-left text-sm font-medium disabled:opacity-60"
        aria-pressed={on}
      >
        <span>Lembretes de pendências</span>
        <span aria-hidden className={cx("relative h-6 w-10 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-black/15")}>
          <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left]", on ? "left-[18px]" : "left-0.5")} />
        </span>
      </button>
      {HINT[state] && <p className="text-[12px] leading-snug text-ink-3">{HINT[state]}</p>}
    </div>
  );
}

/** Convite discreto (Pendências), some quando ativado ou dispensado. */
export function PushPrompt({ publicKey }: { publicKey: string | null }) {
  const { state, enable } = usePush(publicKey);
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem("vl_push_prompt") === "x");
    } catch {
      setDismissed(false);
    }
  }, []);
  if (dismissed || !publicKey || !["off", "ios-install", "busy", "error"].includes(state)) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-line bg-surface p-4 shadow-card">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Receber lembrete de pendências?</p>
        <p className="text-sm text-ink-3">{state === "ios-install" ? HINT["ios-install"] : "Uma notificação por dia quando houver visita sem registro há mais de 24 h."}</p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="min-h-11 rounded-full px-4 text-sm font-semibold text-ink-3 hover:text-ink"
          onClick={() => {
            try {
              localStorage.setItem("vl_push_prompt", "x");
            } catch {}
            setDismissed(true);
          }}
        >
          Agora não
        </button>
        {state !== "ios-install" && (
          <button type="button" onClick={enable} disabled={state === "busy"} className="min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50">
            {state === "busy" ? "Ativando…" : "Ativar"}
          </button>
        )}
      </div>
    </div>
  );
}
