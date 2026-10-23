"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Input, Textarea, cx } from "@/components/ui";
import { updateProposalAction } from "@/app/actions/proposals";

const OPTIONS = [
  { value: "SENT", label: "Enviei ao proprietário", cls: "peer-checked:border-[#2f6fde] peer-checked:bg-[#e7effc] peer-checked:text-[#2357b3]" },
  { value: "COUNTER", label: "Contraproposta", cls: "peer-checked:border-warn peer-checked:bg-warn-soft peer-checked:text-warn" },
  { value: "ACCEPTED", label: "Aceita", cls: "peer-checked:border-good peer-checked:bg-good-soft peer-checked:text-good" },
  { value: "REJECTED", label: "Recusada", cls: "peer-checked:border-bad peer-checked:bg-bad-soft peer-checked:text-bad" },
];

export function ProposalStatusForm({ id, current }: { id: string; current: string }) {
  // sugere o próximo passo natural
  const [status, setStatus] = useState(current === "NEW" ? "SENT" : "");
  return (
    <ActionForm action={updateProposalAction}>
      {(st) => (
        <>
          <input type="hidden" name="id" value={id} />
          <fieldset className="mb-4">
            <legend className="mb-2 text-[15px] font-bold">Andamento da proposta</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {OPTIONS.map((o) => (
                <label key={o.value} className="cursor-pointer">
                  <input type="radio" name="status" value={o.value} checked={status === o.value} onChange={() => setStatus(o.value)} className="peer sr-only" />
                  <span className={cx("flex min-h-12 items-center justify-center rounded-2xl border border-line-strong bg-surface px-2 text-center text-[14px] font-semibold transition", o.cls)}>{o.label}</span>
                </label>
              ))}
            </div>
            {st.fieldErrors?.status && <p className="mt-1.5 text-[13px] font-semibold text-bad">{st.fieldErrors.status}</p>}
          </fieldset>
          {status === "COUNTER" && (
            <div className="mb-4">
              <label htmlFor="counter" className="mb-1.5 block text-[15px] font-bold">
                Valor da contraproposta (R$)
              </label>
              <Input id="counter" name="counter" inputMode="decimal" placeholder="2.500,00" autoComplete="off" />
              {st.fieldErrors?.counter && <p className="mt-1.5 text-[13px] font-semibold text-bad">{st.fieldErrors.counter}</p>}
            </div>
          )}
          <label htmlFor="prop-note" className="mb-1.5 block text-[15px] font-bold">
            Observação <span className="font-normal text-ink-3">{status === "REJECTED" ? "(obrigatória)" : "(opcional)"}</span>
          </label>
          <Textarea id="prop-note" name="note" rows={3} maxLength={1000} placeholder={status === "REJECTED" ? "Motivo. Ex.: proprietário não aceita abaixo de R$ 2.500." : status === "COUNTER" ? "Ex.: aceita R$ 2.450 com o condomínio incluso." : "Ex.: enviada por WhatsApp, ele responde até amanhã."} />
          {st.fieldErrors?.note && <p className="mt-1.5 text-[13px] font-semibold text-bad">{st.fieldErrors.note}</p>}
          <SubmitButton className="mt-4 w-full sm:w-auto">Registrar andamento</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
