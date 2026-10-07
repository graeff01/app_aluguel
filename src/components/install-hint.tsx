"use client";
import { useEffect, useState } from "react";

type BIP = Event & { prompt: () => Promise<void> };

/** Aviso único para instalar o app no celular (some ao instalar ou dispensar). */
export function InstallHint() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [prompt, setPrompt] = useState<BIP | null>(null);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    const mobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("vl_install_hint") === "x";
    } catch {}
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setShow(mobile && !standalone && !dismissed);
    const h = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BIP);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem("vl_install_hint", "x");
    } catch {}
    setShow(false);
  };
  return (
    <div className="animate-rise mb-6 rounded-3xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl border border-line" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Instale o app no celular</p>
          <p className="mt-0.5 text-sm text-ink-3">
            {ios ? (
              <>
                No Safari, toque em <strong className="text-ink-2">Compartilhar</strong> (□↑) e depois em <strong className="text-ink-2">Adicionar à Tela de Início</strong>.
              </>
            ) : prompt ? (
              "Abre direto da tela inicial, como um aplicativo."
            ) : (
              <>
                No Chrome, toque em <strong className="text-ink-2">⋮</strong> e depois em <strong className="text-ink-2">Instalar app</strong>.
              </>
            )}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={dismiss} className="min-h-10 rounded-full px-4 text-sm font-semibold text-ink-3 hover:text-ink">
          Agora não
        </button>
        {prompt && (
          <button
            type="button"
            onClick={() => prompt.prompt().then(dismiss)}
            className="min-h-10 rounded-full bg-primary px-5 text-sm font-semibold text-on-primary"
          >
            Instalar
          </button>
        )}
      </div>
    </div>
  );
}
