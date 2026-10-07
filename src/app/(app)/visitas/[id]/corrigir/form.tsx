"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { correctVisitAction } from "@/app/actions/visits";

type Init = { clientName: string; phoneRaw: string; propertyCode: string; scheduledStart: string; scheduledEnd: string };

export function CorrectionForm({ visitId, version, back, manual, initial }: { visitId: string; version: number; back: string; manual: boolean; initial: Init }) {
  return (
    <ActionForm action={correctVisitAction}>
      {(s) => (
        <>
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="version" value={version} />
          <input type="hidden" name="voltar" value={back} />
          <Field label="Nome do cliente" htmlFor="clientName">
            <Input id="clientName" name="clientName" defaultValue={initial.clientName} autoComplete="off" maxLength={200} />
            <FieldError state={s} name="clientName" />
          </Field>
          <Field label="Telefone" htmlFor="phoneRaw" hint="Com DDD, ex.: (51) 99999-9999. Se não souber, deixe em branco — não invente número.">
            <Input id="phoneRaw" name="phoneRaw" type="tel" inputMode="tel" defaultValue={initial.phoneRaw} maxLength={40} />
          </Field>
          <Field label="Código do imóvel" htmlFor="propertyCode">
            <Input id="propertyCode" name="propertyCode" defaultValue={initial.propertyCode} maxLength={40} inputMode="text" />
            <FieldError state={s} name="propertyCode" />
          </Field>
          {manual && (
            <div className="grid gap-x-3 sm:grid-cols-2">
              <Field label="Início" htmlFor="scheduledStart">
                <Input id="scheduledStart" name="scheduledStart" type="datetime-local" defaultValue={initial.scheduledStart} />
              </Field>
              <Field label="Fim" htmlFor="scheduledEnd">
                <Input id="scheduledEnd" name="scheduledEnd" type="datetime-local" defaultValue={initial.scheduledEnd} />
                <FieldError state={s} name="scheduledEnd" />
              </Field>
            </div>
          )}
          <Field label="Motivo da correção (opcional)" htmlFor="reason">
            <Input id="reason" name="reason" maxLength={500} />
          </Field>
          <SubmitButton className="w-full sm:w-auto">Salvar correção</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
