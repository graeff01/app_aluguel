"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { staffEditVisitAction } from "@/app/actions/visits";

type V = { id: string; version: number; clientName: string; externalRef: string; phoneRaw: string; date: string; time: string; duration: string; consultantId: string; codes: string[] };

export function StaffEditForm({ visit, consultants, today }: { visit: V; consultants: { id: string; name: string }[]; today: string }) {
  const durations = [...new Set([30, 45, 60, 90, 120, Number(visit.duration)])].sort((a, b) => a - b);
  return (
    <ActionForm action={staffEditVisitAction} className="max-w-2xl rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-7">
      {(st) => (
        <>
          <input type="hidden" name="visitId" value={visit.id} />
          <input type="hidden" name="version" value={visit.version} />
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Nome do cliente" htmlFor="clientName" error={st.fieldErrors?.clientName}>
              <Input id="clientName" name="clientName" defaultValue={visit.clientName} autoComplete="off" required />
            </Field>
            <Field label="Nº do atendimento (CRM)" htmlFor="externalRef">
              <Input id="externalRef" name="externalRef" defaultValue={visit.externalRef} inputMode="numeric" autoComplete="off" />
            </Field>
            <Field label="Telefone" htmlFor="phoneRaw">
              <Input id="phoneRaw" name="phoneRaw" type="tel" inputMode="tel" defaultValue={visit.phoneRaw} autoComplete="off" />
            </Field>
            <Field label="Consultora" htmlFor="consultantId" error={st.fieldErrors?.consultantId}>
              <Select id="consultantId" name="consultantId" defaultValue={visit.consultantId} required>
                <option value="" disabled>
                  Escolha
                </option>
                {consultants.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Dia" htmlFor="date">
              <Input id="date" name="date" type="date" defaultValue={visit.date} min={visit.date < today ? visit.date : today} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Horário" htmlFor="time" error={st.fieldErrors?.scheduledStart}>
                <Input id="time" name="time" type="time" defaultValue={visit.time} required />
              </Field>
              <Field label="Duração" htmlFor="duration">
                <Select id="duration" name="duration" defaultValue={visit.duration}>
                  {durations.map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          <div className="mb-5 rounded-2xl border border-line bg-surface-2 p-4">
            <p className="text-sm font-semibold">Imóveis da visita</p>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {visit.codes.map((c) => (
                <span key={c} className="num rounded-full bg-tint px-2.5 py-0.5 text-[13px] font-semibold">
                  {c}
                </span>
              ))}
            </p>
            <div className="mt-3">
              <Field label="Adicionar imóvel" htmlFor="addCodes" hint="Mesmo horário e cliente. Vários: separe com ;. Para tirar um imóvel, use Cancelar ou Trocar imóvel na agenda." error={st.fieldErrors?.addCodes}>
                <Input id="addCodes" name="addCodes" placeholder="835840" autoComplete="off" />
              </Field>
            </div>
          </div>
          {st.fieldErrors?.allowOverlap && (
            <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[14px] text-warn">
              <input type="checkbox" name="allowOverlap" value="1" className="mt-0.5 size-5" />
              <span>
                <strong>Salvar mesmo assim</strong> nesse horário (ex.: imóveis no mesmo prédio).
              </span>
            </label>
          )}
          <SubmitButton className="w-full sm:w-auto">Salvar alterações</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
