"use client";
import { useState } from "react";

/** Copiar o resumo ou mandar pelo WhatsApp (escolhe o contato da captação no próprio WhatsApp). */
export function BriefActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopied(false);
          }
        }}
        className="press inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 text-[13px] font-semibold"
      >
        {copied ? "✓ Copiado" : "Copiar resumo"}
      </button>
      <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-10 items-center rounded-full bg-[#1fa855] px-4 text-[13px] font-semibold text-white">
        Enviar pelo WhatsApp
      </a>
    </div>
  );
}
