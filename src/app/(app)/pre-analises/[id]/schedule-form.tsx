"use client";
import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { PropertyLookup } from "@/components/property-lookup";
import { schedulePreVisitAction } from "@/app/actions/pre-analysis";

/** Pré-análise aprovada → visita: cliente já preenchido; escolhe dia, horário e imóvel. */
export function SchedulePreVisitForm({ id, propertyCode, defaultDate }: { id: string; propertyCode: string; defaultDate: string }) {
  const [code, setCode] = useState(propertyCode);
  const requestId = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), []);
  return (
    <ActionForm action={schedulePreVisitAction}>
      {(st) => (
        <>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="requestId" value={requestId} />
          <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">
            <Field label="Data" htmlFor="pv-date" error={st.fieldErrors?.scheduledStart}>
              <Input id="pv-date" name="date" type="date" defaultValue={defaultDate} required />
            </Field>
            <Field label="Horário" htmlFor="pv-time">
              <Input id="pv-time" name="time" type="time" required />
            </Field>
            <Field label="Duração" htmlFor="pv-duration">
              <Select id="pv-duration" name="duration" defaultValue="60">
                {[30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {({ 30: "30 min", 45: "45 min", 60: "1 h", 90: "1h30", 120: "2 h" } as Record<number, string>)[m]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Código do imóvel" htmlFor="pv-code" error={st.fieldErrors?.propertyCode}>
            <Input id="pv-code" name="propertyCode" inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required />
            <PropertyLookup code={code} />
          </Field>
          {st.fieldErrors?.allowOverlap && (
            <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[14px] text-warn">
              <input type="checkbox" name="allowOverlap" value="1" className="mt-0.5 size-5" />
              <span>
                <strong>Marcar mesmo assim</strong> nesse horário.
              </span>
            </label>
          )}
          <SubmitButton className="w-full sm:w-auto">Agendar e preparar a agenda</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
