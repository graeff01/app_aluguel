"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { topicForPath } from "@/lib/help-content";

/** Botão "?" no canto: passo a passo da tela atual e o caminho para a ajuda completa. */
export function HelpButton({ role, low = false }: { role: string; low?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  if (path.startsWith("/ajuda")) return null;
  const topic = topicForPath(role, path);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Ajuda desta tela"
        aria-expanded={open}
        className={`press fixed right-4 ${low ? "bottom-5" : "bottom-24"} z-30 grid size-11 place-items-center rounded-full border border-line bg-surface text-[18px] font-bold text-ink-2 shadow-float hover:text-ink md:right-6 md:bottom-6`}
      >
        ?
      </button>
      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Ajuda" className={`fixed right-4 ${low ? "bottom-19" : "bottom-38"} z-40 max-h-[70dvh] w-[min(380px,calc(100vw-32px))] overflow-y-auto rounded-3xl border border-line bg-surface p-5 shadow-float md:right-6 md:bottom-20`}>
            <p className="text-[12px] font-bold tracking-[0.12em] text-accent-strong uppercase">Ajuda desta tela</p>
            {topic ? (
              <>
                <p className="mt-1 text-[18px] font-bold tracking-[-0.01em]">{topic.title}</p>
                <p className="mt-1 text-[14px] text-ink-2">{topic.summary}</p>
                <ol className="mt-3 space-y-2">
                  {topic.steps.map((s, i) => (
                    <li key={i} className="flex gap-3 text-[14px] leading-snug">
                      <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-tint text-[12px] font-bold">{i + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
                {topic.tips?.length ? (
                  <ul className="mt-3 space-y-1 rounded-2xl bg-surface-2 p-3 text-[13px] text-ink-2">
                    {topic.tips.map((t, i) => (
                      <li key={i}>💡 {t}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-[14px] text-ink-2">Veja o passo a passo de todas as telas e as dúvidas frequentes na central de ajuda.</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/ajuda" onClick={() => setOpen(false)} className="press inline-flex min-h-10 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary">
                Central de ajuda
              </Link>
              <Link href="/ajuda/novidades" onClick={() => setOpen(false)} className="press inline-flex min-h-10 items-center rounded-full border border-line-strong px-4 text-[13px] font-semibold">
                O que mudou
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}
