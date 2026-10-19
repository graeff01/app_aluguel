"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { markChangelogSeenAction } from "@/app/actions/auth";
import { changeDate, type ChangelogEntry } from "@/lib/changelog";

/** "O que mudou": aparece uma vez no próximo acesso depois de uma atualização. */
export function WhatsNew({ entries }: { entries: ChangelogEntry[] }) {
  const [open, setOpen] = useState(true);
  const [pending, start] = useTransition();
  if (!open) return null;
  const close = () =>
    start(async () => {
      await markChangelogSeenAction();
      setOpen(false);
    });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-[28px] bg-surface p-6 shadow-float">
        <p className="text-[12px] font-bold tracking-[0.12em] text-accent-strong uppercase">Novidades no app</p>
        <h2 id="whats-new-title" className="mt-1 text-[24px] leading-tight font-bold tracking-[-0.02em]">
          O que mudou
        </h2>
        {entries.map((e) => (
          <section key={e.id} className="mt-5">
            <p className="text-[13px] font-semibold text-ink-3">
              {changeDate(e.id)} · {e.title}
            </p>
            <ul className="mt-2 space-y-2.5">
              {e.changes.map((c, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-snug">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                  <span>
                    {c.text}
                    {c.href && (
                      <>
                        {" "}
                        <Link href={c.href} onClick={close} className="font-semibold text-accent-strong underline-offset-4 hover:underline">
                          Ver →
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="mt-5 text-[13px] text-ink-3">Dúvidas? Toque no “?” no canto da tela, em qualquer tela.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={close} disabled={pending} className="press min-h-12 flex-1 rounded-full bg-primary px-6 font-semibold text-on-primary">
            {pending ? "…" : "Entendi"}
          </button>
          <Link href="/ajuda" onClick={close} className="press inline-flex min-h-12 items-center rounded-full border border-line-strong px-5 font-semibold">
            Central de ajuda
          </Link>
        </div>
      </div>
    </div>
  );
}
