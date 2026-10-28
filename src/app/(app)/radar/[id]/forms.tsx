"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { closeRadarAction, reopenRadarAction, updateRadarAction } from "@/app/actions/radar";

/** O que aconteceu, quando cobrar de novo e, se a captação achou, os códigos. */
export function RadarUpdateForm({ id, sent }: { id: string; sent: boolean }) {
  return (
    <ActionForm action={updateRadarAction} resetOnSuccess>
      {(s) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="O que aconteceu?" htmlFor="radar-note" error={s.fieldErrors?.note}>
            <Textarea id="radar-note" name="note" rows={3} maxLength={1500} required placeholder="Ex.: cobrei a captação, estão vendo duas casas no Centro." />
          </Field>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="A captação achou? Códigos (opcional)" htmlFor="foundCodes" hint="Vários: separe com ;" error={s.fieldErrors?.foundCodes}>
              <Input id="foundCodes" name="foundCodes" placeholder="734999;812001" autoComplete="off" />
            </Field>
            <Field label="Cobrar de novo em" htmlFor="followUpDays">
              <Select id="followUpDays" name="followUpDays" defaultValue="3">
                {[1, 2, 3, 5, 7, 10, 15].map((d) => (
                  <option key={d} value={d}>
                    {d} dia{d > 1 ? "s" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {!sent && (
            <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[14px]">
              <input type="checkbox" name="sentToCapture" value="1" className="mt-0.5 size-5" />
              <span>
                <strong>Passei para a captação</strong>
              </span>
            </label>
          )}
          <SubmitButton>Salvar atualização</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RadarCloseForm({ id, reasons }: { id: string; reasons: string[] }) {
  return (
    <ActionForm action={closeRadarAction}>
      {(s) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Como terminou" htmlFor="reason" error={s.fieldErrors?.reason}>
            <Select id="reason" name="reason" required defaultValue="">
              <option value="" disabled>
                Escolha
              </option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Observação (opcional)" htmlFor="close-note">
            <Textarea id="close-note" name="note" rows={2} maxLength={1000} />
          </Field>
          <FieldError state={s} name="note" />
          <SubmitButton variant="secondary">Encerrar pedido</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RadarReopen({ id }: { id: string }) {
  return (
    <ActionForm action={reopenRadarAction} className="mt-3">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="secondary">Reabrir</SubmitButton>
    </ActionForm>
  );
}
