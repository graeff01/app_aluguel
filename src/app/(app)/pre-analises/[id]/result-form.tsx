"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Textarea, cx } from "@/components/ui";
import { resolvePreAnalysisAction } from "@/app/actions/pre-analysis";

const OPTIONS = [
  { value: "APPROVED", label: "Aprovado", cls: "peer-checked:border-good peer-checked:bg-good-soft peer-checked:text-good" },
  { value: "PENDING", label: "Pendente", cls: "peer-checked:border-[#2f6fde] peer-checked:bg-[#e7effc] peer-checked:text-[#2357b3]" },
  { value: "REJECTED", label: "Reprovado", cls: "peer-checked:border-bad peer-checked:bg-bad-soft peer-checked:text-bad" },
];

export function ResultForm({ id, current }: { id: string; current: string }) {
  const [status, setStatus] = useState(current === "AWAITING" ? "" : current);
  return (
    <ActionForm action={resolvePreAnalysisAction}>
      {(st) => (
        <>
          <input type="hidden" name="id" value={id} />
          <fieldset className="mb-4">
            <legend className="mb-2 text-[15px] font-bold">Resultado da pré-análise</legend>
            <div className="grid grid-cols-3 gap-2">
              {OPTIONS.map((o) => (
                <label key={o.value} className="cursor-pointer">
                  <input type="radio" name="status" value={o.value} checked={status === o.value} onChange={() => setStatus(o.value)} className="peer sr-only" />
                  <span className={cx("flex min-h-12 items-center justify-center rounded-2xl border border-line-strong bg-surface text-[15px] font-semibold transition", o.cls)}>{o.label}</span>
                </label>
              ))}
            </div>
            {st.fieldErrors?.status && <p className="mt-1.5 text-[13px] font-semibold text-bad">{st.fieldErrors.status}</p>}
          </fieldset>
          <label htmlFor="pre-note" className="mb-1.5 block text-[15px] font-bold">
            Observação <span className="font-normal text-ink-3">(obrigatória)</span>
          </label>
          <Textarea id="pre-note" name="note" rows={3} maxLength={1000} placeholder={status === "PENDING" ? "O que falta? Ex.: comprovante de renda dos últimos 3 meses." : status === "REJECTED" ? "Motivo. Ex.: renda insuficiente para o valor." : "Ex.: aprovado sem fiador."} />
          {st.fieldErrors?.note && <p className="mt-1.5 text-[13px] font-semibold text-bad">{st.fieldErrors.note}</p>}
          <SubmitButton className="mt-4 w-full sm:w-auto">Registrar resultado</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
