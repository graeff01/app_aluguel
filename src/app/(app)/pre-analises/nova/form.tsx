"use client";
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { createPreAnalysisAction } from "@/app/actions/pre-analysis";

const cpfMask = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
};

export function PreAnalysisForm({ consultants }: { consultants: { id: string; name: string }[] }) {
  const [cpf, setCpf] = useState("");
  return (
    <ActionForm action={createPreAnalysisAction} className="max-w-2xl rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-7">
      {(st) => (
        <>
          <p className="mb-5 rounded-2xl bg-accent-soft px-4 py-3 text-[14px] font-medium text-accent-strong">Todos os dados precisam ser do <strong>titular do CPF</strong>.</p>
          <Field label="Nome completo" htmlFor="fullName" error={st.fieldErrors?.fullName}>
            <Input id="fullName" name="fullName" autoComplete="off" required />
          </Field>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="CPF" htmlFor="cpf" error={st.fieldErrors?.cpf}>
              <Input id="cpf" name="cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(cpfMask(e.target.value))} required />
            </Field>
            <Field label="Data de nascimento" htmlFor="birthDate" error={st.fieldErrors?.birthDate}>
              <Input id="birthDate" name="birthDate" type="date" required />
            </Field>
            <Field label="E-mail" htmlFor="email" error={st.fieldErrors?.email}>
              <Input id="email" name="email" type="email" inputMode="email" autoComplete="off" required />
            </Field>
            <Field label="Telefone" htmlFor="phone" error={st.fieldErrors?.phone}>
              <Input id="phone" name="phone" type="tel" inputMode="tel" placeholder="(51) 99999-9999" autoComplete="off" required />
            </Field>
            <Field label="Salário (R$)" htmlFor="salary" error={st.fieldErrors?.salary} hint="Renda mensal bruta do titular.">
              <Input id="salary" name="salary" inputMode="decimal" placeholder="4.500,00" autoComplete="off" required />
            </Field>
            <Field label="Imóvel de interesse (opcional)" htmlFor="propertyCode">
              <Input id="propertyCode" name="propertyCode" inputMode="numeric" placeholder="Código do imóvel" autoComplete="off" />
            </Field>
          </div>
          <Field label="Encaminhar para a consultora" htmlFor="consultantId" error={st.fieldErrors?.consultantId}>
            <Select id="consultantId" name="consultantId" required defaultValue="">
              <option value="" disabled>
                Escolha…
              </option>
              {consultants.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Observação (opcional)" htmlFor="note" hint="Ex.: tem fiador, prefere contato à tarde. Não repita CPF ou dados aqui.">
            <Textarea id="note" name="note" rows={3} maxLength={1000} />
          </Field>
          <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-4 py-3 text-[14px]">
            <input type="checkbox" name="holder" value="1" required className="mt-0.5 size-5 accent-[var(--accent)]" />
            <span>Confirmo que os dados são do <strong>titular do CPF</strong> e que ele autorizou a pré-análise para a locação.</span>
          </label>
          <FieldError state={st} name="holderConfirmed" />
          <SubmitButton className="w-full sm:w-auto">Enviar para a consultora</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
