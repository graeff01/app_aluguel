"use client";
import { useMemo } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { createVisitAction } from "@/app/actions/visits";

export function NewVisitForm({ consultants, defaultStart }: { consultants: { id: string; name: string }[]; defaultStart: string }) {
  const requestId = useMemo(() => crypto.randomUUID(), []);
  return (
    <ActionForm action={createVisitAction} className="max-w-xl">
      {(s) => (
        <>
          <input type="hidden" name="requestId" value={requestId} />
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label="Data e hora" htmlFor="scheduledStart">
              <Input id="scheduledStart" name="scheduledStart" type="datetime-local" defaultValue={defaultStart} required />
              <FieldError state={s} name="scheduledStart" />
            </Field>
            <Field label="Duração" htmlFor="duration">
              <Select id="duration" name="duration" defaultValue="60">
                <option value="30">30 min</option>
                <option value="60">1 h</option>
                <option value="90">1 h 30</option>
                <option value="120">2 h</option>
              </Select>
            </Field>
          </div>
          <Field label="Nome do cliente" htmlFor="clientName">
            <Input id="clientName" name="clientName" required maxLength={200} autoComplete="off" />
            <FieldError state={s} name="clientName" />
          </Field>
          <Field label="Telefone (com DDD)" htmlFor="phoneRaw" hint="Opcional. Sem telefone, o cadastro fica com identificação pendente.">
            <Input id="phoneRaw" name="phoneRaw" type="tel" inputMode="tel" maxLength={40} />
          </Field>
          <Field label="Código do imóvel" htmlFor="propertyCode">
            <Input id="propertyCode" name="propertyCode" required maxLength={40} />
            <FieldError state={s} name="propertyCode" />
          </Field>
          {consultants.length > 0 && (
            <Field label="Consultora responsável" htmlFor="consultantId">
              <Select id="consultantId" name="consultantId" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {consultants.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <FieldError state={s} name="consultantId" />
            </Field>
          )}
          <SubmitButton className="w-full sm:w-auto">Cadastrar visita</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
