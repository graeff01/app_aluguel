"use client";
import { useState, useTransition } from "react";
import { setPresenceAction } from "@/app/actions/visits";
import { cx } from "./ui";

/** WhatsApp com a mensagem pronta (a consultora envia) + registrar a resposta do cliente. */
export function ConfirmPresence({ visitId, url, status }: { visitId: string; url: string; status: string | null }) {
  const [asked, setAsked] = useState(false);
  const [cur, setCur] = useState(status);
  const [pending, start] = useTransition();
  const set = (s: "CONFIRMED" | "NO_REPLY" | null) =>
    start(async () => {
      const r = await setPresenceAction(visitId, s);
      if (r.ok) setCur(s);
    });
  if (cur === "CONFIRMED")
    return (
      <div className="flex items-center justify-between gap-2 rounded-2xl bg-good-soft px-3.5 py-2 text-[13px] font-semibold text-good">
        <span>✓ Cliente confirmou presença</span>
        <button type="button" onClick={() => set(null)} disabled={pending} className="text-[12px] font-medium text-good/70 underline underline-offset-2">
          desfazer
        </button>
      </div>
    );
  return (
    <div className="rounded-2xl border border-[#25d366]/30 bg-[#25d366]/[0.07] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setAsked(true)}
          className="press inline-flex min-h-10 items-center gap-2 rounded-full bg-[#1f9e4f] px-4 text-[13px] font-semibold text-white"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="currentColor">
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.2.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3 1 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2.1.7 2.8.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
          </svg>
          {cur === "NO_REPLY" ? "Tentar de novo" : "Confirmar presença"}
        </a>
        {(asked || cur === "NO_REPLY") && (
          <>
            <button type="button" onClick={() => set("CONFIRMED")} disabled={pending} className="press min-h-10 rounded-full bg-surface px-3.5 text-[13px] font-semibold text-good ring-1 ring-good/30">
              ✓ Confirmou
            </button>
            {cur !== "NO_REPLY" && (
              <button type="button" onClick={() => set("NO_REPLY")} disabled={pending} className="press min-h-10 rounded-full bg-surface px-3.5 text-[13px] font-semibold text-ink-2 ring-1 ring-line-strong">
                Sem resposta
              </button>
            )}
          </>
        )}
      </div>
      <p className={cx("mt-1.5 text-[12px]", cur === "NO_REPLY" ? "font-semibold text-warn" : "text-ink-3")}>
        {cur === "NO_REPLY" ? "Sem resposta do cliente até agora." : asked ? "Depois que ele responder, marque aqui." : "Abre o WhatsApp com a mensagem pronta; você envia."}
      </p>
    </div>
  );
}
