"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { marketNoteAction } from "@/app/actions/market";
import { MARKET_TAGS, type MarketTag } from "@/lib/market-tags";
import { cx } from "./ui";

/**
 * Leitura de mercado da captação (parecer do pedido ou leitura do perfil): uma opção rápida, o valor realista e um
 * texto livre.
 */
export function MarketNoteForm({ hidden, label, initial, compact }: { hidden: Record<string, string>; label: string; initial?: { tag?: string | null; text?: string | null; cents?: number | null }; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tag, setTag] = useState<string>(initial?.tag ?? "");
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={cx("press inline-flex items-center text-[13px] font-semibold", compact ? "mt-1 min-h-9 text-ink-2 hover:text-ink" : "mt-3 min-h-10 rounded-full border border-line-strong px-4")}>
        {label}
      </button>
    );
  const fields = (
    <>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="tag" value={tag} />
      <p className="mb-2 text-[13px] font-semibold">O que o mercado oferece para esse perfil?</p>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(MARKET_TAGS) as MarketTag[]).map((k) => (
          <button key={k} type="button" onClick={() => setTag(k)} aria-pressed={tag === k} className={cx("press min-h-9 rounded-full border px-3 text-[12px] font-semibold", tag === k ? "border-accent bg-accent-soft text-accent-strong" : "border-line-strong")}>
            {MARKET_TAGS[k]}
          </button>
        ))}
      </div>
      <label className="mt-3 mb-1 block text-[13px] font-semibold" htmlFor={`mk-v-${Object.values(hidden).join("-")}`}>
        Valor realista para esse perfil <span className="font-normal text-ink-3">(opcional)</span>
      </label>
      <input id={`mk-v-${Object.values(hidden).join("-")}`} name="realistic" inputMode="decimal" placeholder="Ex.: 2.800" defaultValue={initial?.cents ? String(initial.cents / 100) : ""} className="block min-h-10 w-full max-w-48 rounded-xl border border-line-strong bg-surface px-3 text-[14px]" />
      <label className="mt-3 mb-1 block text-[13px] font-semibold" htmlFor={`mk-t-${Object.values(hidden).join("-")}`}>
        Observação <span className="font-normal text-ink-3">(ajuda na conversa com o cliente)</span>
      </label>
      <textarea id={`mk-t-${Object.values(hidden).join("-")}`} name="text" rows={2} maxLength={600} defaultValue={initial?.text ?? ""} placeholder="Ex.: casa com pátio no bairro costuma passar de R$ 2.800; até R$ 2.300 só com 1 quarto." className="block w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-[14px]" />
    </>
  );
  return (
    <ActionForm action={marketNoteAction} className="mt-3 basis-full rounded-2xl border border-line bg-surface-2 p-3">
      {(s) => (
        <>
          {fields}
          {(s.fieldErrors?.tag || s.fieldErrors?.realistic) && <p className="mt-2 text-[13px] font-semibold text-bad">{s.fieldErrors?.tag ?? s.fieldErrors?.realistic}</p>}
          <div className="mt-3 flex gap-2">
            <SubmitButton className="min-h-10 px-4 text-[13px]">Salvar leitura</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="press min-h-10 rounded-full px-3 text-[13px] font-semibold text-ink-2">
              Voltar
            </button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
