"use client";
import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallHelp() {
  const [standalone, setStandalone] = useState(false);
  const [prompt, setPrompt] = useState<BIPEvent | null>(null);
  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    const h = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  if (standalone) return <p className="rounded-3xl border border-line bg-surface p-5 shadow-card text-ink-2">✓ O aplicativo já está instalado neste aparelho.</p>;
  return (
    <div className="rounded-3xl border border-line bg-surface p-5 shadow-card">
      {prompt && (
        <button className="mb-4 min-h-12 rounded-full bg-primary px-6 font-semibold text-on-primary shadow-float" onClick={() => prompt.prompt().then(() => setPrompt(null))}>
          Instalar aplicativo
        </button>
      )}
      <p className="font-semibold">Android (Chrome)</p>
      <p className="mb-3 text-ink-2">Toque no menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”.</p>
      <p className="font-semibold">iPhone (Safari)</p>
      <p className="text-ink-2">Toque em Compartilhar (□↑) e depois em “Adicionar à Tela de Início”. No iPhone, use o Safari.</p>
      <p className="mt-3 text-sm text-ink-3">Salvar resultados exige internet; o app não guarda registros offline.</p>
    </div>
  );
}
