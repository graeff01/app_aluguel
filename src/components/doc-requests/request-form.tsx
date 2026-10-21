"use client";
import { useActionState, useState } from "react";
import { createDocRequestAction, type DocCreateState } from "@/app/actions/doc-requests";
import type { DocItem } from "@/server/doc-requests";
import { SubmitButton } from "@/components/action-form";
import { cx } from "@/components/ui";
import { ShareButtons } from "./share-buttons";

/** Escolher os documentos e gerar o link (ou incluir itens no link que o cliente já tem). */
export function DocRequestForm(p: { target: { preAnalysisId?: string; visitId?: string }; presets: DocItem[]; suggested: string[]; hasPhone: boolean; open?: boolean }) {
  const [state, action] = useActionState<DocCreateState, FormData>(createDocRequestAction, { ok: false });
  const [checked, setChecked] = useState<string[]>(p.suggested);
  const [expanded, setExpanded] = useState(!!p.open);

  if (state.ok && state.url) {
    return (
      <div className="animate-rise rounded-2xl border border-good/25 bg-good-soft p-4">
        <p className="text-[15px] font-bold text-good">✓ {state.message}</p>
        <p className="mt-0.5 text-[13px] text-good/80">Agora envie para o cliente. A mensagem já vai pronta.</p>
        <ShareButtons url={state.url} whatsapp={state.whatsapp ?? null} className="mt-3" />
      </div>
    );
  }
  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="press inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-semibold text-white shadow-float">
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
        </svg>
        Pedir documentos ao cliente
      </button>
    );
  }
  return (
    <form action={action} className="animate-rise">
      {p.target.preAnalysisId && <input type="hidden" name="preAnalysisId" value={p.target.preAnalysisId} />}
      {p.target.visitId && <input type="hidden" name="visitId" value={p.target.visitId} />}
      <fieldset>
        <legend className="mb-2 text-[15px] font-bold">Quais documentos?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {p.presets.map((i) => {
            const on = checked.includes(i.key);
            return (
              <label key={i.key} className={cx("flex cursor-pointer items-start gap-3 rounded-2xl border px-3.5 py-3 text-[14px] transition-colors", on ? "border-accent bg-accent-soft" : "border-line bg-surface")}>
                <input type="checkbox" name="item" value={i.key} checked={on} onChange={(e) => setChecked((c) => (e.target.checked ? [...c, i.key] : c.filter((x) => x !== i.key)))} className="mt-0.5 size-5 accent-[var(--accent)]" />
                <span>
                  <span className="block font-semibold">{i.label}</span>
                  {!i.required && <span className="text-[12px] text-ink-3">opcional para o cliente</span>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="mt-4 block text-[14px] font-semibold" htmlFor="doc-custom">
        Outro documento <span className="font-normal text-ink-3">(opcional, um por linha)</span>
      </label>
      <textarea id="doc-custom" name="custom" rows={2} maxLength={300} placeholder="Ex.: Contracheque do cônjuge" className="mt-1.5 block w-full rounded-2xl border border-line-strong bg-surface px-4 py-3 text-[15px]" />
      <label className="mt-4 block text-[14px] font-semibold" htmlFor="doc-message">
        Recado para o cliente <span className="font-normal text-ink-3">(opcional, aparece no link)</span>
      </label>
      <textarea id="doc-message" name="message" rows={2} maxLength={500} placeholder="Ex.: Pode mandar o holerite em PDF, que fica mais legível." className="mt-1.5 block w-full rounded-2xl border border-line-strong bg-surface px-4 py-3 text-[15px]" />
      {!p.hasPhone && (
        <>
          <label className="mt-4 block text-[14px] font-semibold" htmlFor="doc-phone">
            Celular do cliente (com DDD)
          </label>
          <input id="doc-phone" name="phone" type="tel" inputMode="tel" required className="mt-1.5 block min-h-12 w-full rounded-2xl border border-line-strong bg-surface px-4 text-[15px]" />
        </>
      )}
      {state.message && !state.ok && (
        <p role="alert" className="mt-3 rounded-xl bg-bad-soft px-3 py-2 text-[13px] font-semibold text-bad">
          {state.message}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton>Gerar link seguro</SubmitButton>
        <button type="button" onClick={() => setExpanded(false)} className="min-h-11 text-[14px] font-semibold text-ink-3">
          Cancelar
        </button>
      </div>
      <p className="mt-3 text-[12px] text-ink-3">O cliente confirma os 3 primeiros números do CPF (ou os 4 últimos do celular) antes de enviar. O link vale 7 dias.</p>
    </form>
  );
}
