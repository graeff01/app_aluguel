"use client";
import { useMemo } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Textarea } from "@/components/ui";
import { createProposalAction } from "@/app/actions/proposals";
import { ConsultantPicker, type QueueItem } from "@/components/consultant-picker";

export function ProposalForm({ consultants }: { consultants: QueueItem[] }) {
  const requestId = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), []);
  return (
    <ActionForm action={createProposalAction} className="max-w-2xl rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-7">
      {(st) => (
        <>
          <input type="hidden" name="requestId" value={requestId} />
          <Field label="Nome do cliente" htmlFor="clientName" error={st.fieldErrors?.clientName}>
            <Input id="clientName" name="clientName" autoComplete="off" required />
          </Field>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Telefone" htmlFor="phone" error={st.fieldErrors?.phone}>
              <Input id="phone" name="phone" type="tel" inputMode="tel" placeholder="(51) 99999-9999" autoComplete="off" required />
            </Field>
            <Field label="Código do imóvel" htmlFor="propertyCode" error={st.fieldErrors?.propertyCode}>
              <Input id="propertyCode" name="propertyCode" inputMode="numeric" placeholder="Ex.: 734999" autoComplete="off" required />
            </Field>
          </div>
          <Field label="Valor proposto para o aluguel (R$)" htmlFor="rent" error={st.fieldErrors?.rent} hint="O valor mensal que o cliente propõe pagar.">
            <Input id="rent" name="rent" inputMode="decimal" placeholder="2.300,00" autoComplete="off" required />
          </Field>
          <ConsultantPicker consultants={consultants} error={st.fieldErrors?.consultantId} />
          <Field label="Observação (opcional)" htmlFor="note" hint="Ex.: quer entrar no dia 10, pede para incluir a vaga.">
            <Textarea id="note" name="note" rows={3} maxLength={1000} />
          </Field>
          {st.fieldErrors?.confirmAway && (
            <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[14px] text-warn">
              <input type="checkbox" name="confirmAway" value="1" className="mt-0.5 size-5" />
              <span>
                <strong>Enviar mesmo assim</strong> para a consultora ausente (ela vê quando voltar).
              </span>
            </label>
          )}
          <SubmitButton className="w-full sm:w-auto">Enviar para a consultora</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
