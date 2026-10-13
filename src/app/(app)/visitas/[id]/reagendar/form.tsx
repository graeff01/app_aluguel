"use client";
import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea, cx } from "@/components/ui";
import { rescheduleAction } from "@/app/actions/visits";

export function RescheduleForm({ visitId, canReschedule, defaultDate, defaultTime, defaultDuration, propertyCode }: { visitId: string; canReschedule: boolean; defaultDate: string; defaultTime: string; defaultDuration: number; propertyCode: string }) {
  const [code, setCode] = useState(propertyCode);
  const mode: "reschedule" | "new" = canReschedule ? "reschedule" : "new";
  const requestId = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), []);
  return (
    <ActionForm action={rescheduleAction} className="rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
      {(st) => (
        <>
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="mode" value={mode} />
          <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">
            <Field label="Nova data" htmlFor="date" error={st.fieldErrors?.scheduledStart}>
              <Input id="date" name="date" type="date" defaultValue={defaultDate} required />
            </Field>
            <Field label="Horário" htmlFor="time">
              <Input id="time" name="time" type="time" defaultValue={defaultTime} required />
            </Field>
            <Field label="Duração" htmlFor="duration">
              <Select id="duration" name="duration" defaultValue={String(defaultDuration)}>
                {[30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {({ 30: "30 min", 45: "45 min", 60: "1 h", 90: "1h30", 120: "2 h" } as Record<number, string>)[m]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Código do imóvel" htmlFor="propertyCode" error={st.fieldErrors?.propertyCode} hint={code.trim() && code.trim() !== propertyCode ? `Outro imóvel: a nova visita e a agenda vão com o ${code.trim()}, mesmo cliente.` : "Mesmo imóvel. Troque o código se o cliente for ver outro."}>
            <Input id="propertyCode" name="propertyCode" inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
          <Field label="Motivo (opcional)" htmlFor="note" hint="Ex.: cliente pediu outro dia.">
            <Textarea id="note" name="note" rows={2} maxLength={300} />
          </Field>
          <SubmitButton className="w-full">{mode === "reschedule" ? "Remarcar e preparar a agenda" : "Marcar e preparar a agenda"}</SubmitButton>
          <p className="mt-3 text-center text-[12px] text-ink-3">No próximo passo, um toque abre o Google Agenda com tudo preenchido.</p>
        </>
      )}
    </ActionForm>
  );
}
