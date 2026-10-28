"use client";
import { useMemo } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { createRadarAction } from "@/app/actions/radar";

export function RadarForm({ types }: { types: string[] }) {
  const requestId = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), []);
  return (
    <ActionForm action={createRadarAction} className="max-w-2xl rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-7">
      {(st) => (
        <>
          <input type="hidden" name="requestId" value={requestId} />
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Nome do cliente" htmlFor="clientName" error={st.fieldErrors?.clientName}>
              <Input id="clientName" name="clientName" autoComplete="off" required />
            </Field>
            <Field label="Telefone" htmlFor="phone" error={st.fieldErrors?.phone}>
              <Input id="phone" name="phone" type="tel" inputMode="tel" placeholder="(51) 99999-9999" autoComplete="off" required />
            </Field>
          </div>
          <Field label="O que o cliente procura" htmlFor="wants" error={st.fieldErrors?.wants} hint="Do jeito que ele falou. Ex.: casa com pátio para cachorro, perto da escola no Centro.">
            <Textarea id="wants" name="wants" rows={3} maxLength={1500} required />
          </Field>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Tipo (opcional)" htmlFor="propertyType">
              <Select id="propertyType" name="propertyType" defaultValue="">
                <option value="">Qualquer</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quartos (opcional)" htmlFor="bedrooms">
              <Input id="bedrooms" name="bedrooms" inputMode="numeric" maxLength={2} placeholder="2" />
            </Field>
            <Field label="Valor total máximo (opcional)" htmlFor="maxBudget" error={st.fieldErrors?.maxBudget}>
              <Input id="maxBudget" name="maxBudget" inputMode="decimal" placeholder="2.500,00" autoComplete="off" />
            </Field>
            <Field label="Bairros / regiões (opcional)" htmlFor="areas" hint="Separe com vírgula.">
              <Input id="areas" name="areas" placeholder="Centro, Marechal Rondon" autoComplete="off" />
            </Field>
          </div>
          <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[14px]">
            <input type="checkbox" name="sentToCapture" value="1" defaultChecked className="mt-0.5 size-5" />
            <span>
              <strong>Já passei para a captação</strong>
            </span>
          </label>
          <Field label="Cobrar a captação em" htmlFor="followUpDays">
            <Select id="followUpDays" name="followUpDays" defaultValue="3">
              {[1, 2, 3, 5, 7, 10, 15].map((d) => (
                <option key={d} value={d}>
                  {d} dia{d > 1 ? "s" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <SubmitButton className="w-full sm:w-auto">Colocar no radar</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
