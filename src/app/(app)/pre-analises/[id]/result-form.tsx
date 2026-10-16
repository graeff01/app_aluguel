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

export function ResultForm({ id, current, missingOptions = [], currentMissing = [] }: { id: string; current: string; missingOptions?: { id: string; label: string }[]; currentMissing?: string[] }) {
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
          {status === "PENDING" && missingOptions.length > 0 && (
            <fieldset className="mb-4">
              <legend className="mb-2 text-[15px] font-bold">O que falta?</legend>
              <div className="flex flex-wrap gap-2">
                {missingOptions.map((m) => (
                  <label key={m.id} className="press cursor-pointer">
                    <input type="checkbox" name="missing" value={m.id} defaultChecked={currentMissing.includes(m.label)} className="peer sr-only" />
                    <span className="inline-flex min-h-10 items-center rounded-full border-2 border-line bg-surface px-3.5 text-[13px] font-semibold transition peer-checked:border-[#2f6fde] peer-checked:bg-[#e7effc] peer-checked:text-[#2357b3] peer-focus-visible:ring-2 peer-focus-visible:ring-accent dark:peer-checked:bg-[#1f2c44] dark:peer-checked:text-[#93b8ff]">
                      {m.label}
                    </span>
                  </label>
                ))}
              </div>
              {st.fieldErrors?.missing && <p className="mt-1.5 text-[13px] font-semibold text-bad">{st.fieldErrors.missing}</p>}
              <p className="mt-2 text-[12px] text-ink-3">O pré-atendimento recebe a lista e, quando anexar, a pré-análise volta para você.</p>
            </fieldset>
          )}
          <label htmlFor="pre-note" className="mb-1.5 block text-[15px] font-bold">
            Observação <span className="font-normal text-ink-3">{status === "PENDING" ? "(opcional)" : "(obrigatória)"}</span>
          </label>
          <Textarea id="pre-note" name="note" rows={3} maxLength={1000} placeholder={status === "PENDING" ? "O que falta? Ex.: comprovante de renda dos últimos 3 meses." : status === "REJECTED" ? "Motivo. Ex.: renda insuficiente para o valor." : "Ex.: aprovado sem fiador."} />
          {st.fieldErrors?.note && <p className="mt-1.5 text-[13px] font-semibold text-bad">{st.fieldErrors.note}</p>}
          <SubmitButton className="mt-4 w-full sm:w-auto">Registrar resultado</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
