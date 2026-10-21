"use client";
import { useState } from "react";
import { cx } from "@/components/ui";

export function ShareButtons({ url, whatsapp, className }: { url: string; whatsapp: string | null; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cx("flex flex-wrap gap-2", className)}>
      {whatsapp && (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-[#1f9d55] px-4 text-[14px] font-semibold text-white">
          <svg aria-hidden viewBox="0 0 24 24" className="size-4.5" fill="currentColor">
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8 0-1.4.7-2 1-2.3.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.8.9c.3.1.5.2.5.3.1.1.1.7-.1 1.4Z" />
          </svg>
          Enviar no WhatsApp
        </a>
      )}
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {}
        }}
        className="press inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4 text-[14px] font-semibold"
      >
        {copied ? "Copiado ✓" : "Copiar link"}
      </button>
    </div>
  );
}
