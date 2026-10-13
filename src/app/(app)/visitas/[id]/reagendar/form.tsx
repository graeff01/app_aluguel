"use client";
import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea, cx } from "@/components/ui";
import { rescheduleAction } from "@/app/actions/visits";

export function RescheduleForm({ visitId, canReschedule, defaultDate, defaultTime, defaultDuration }: { visitId: string; canReschedule: boolean; defaultDate: string; defaultTime: string; defaultDuration: number }) {
  const [mode, setMode] = useState<"reschedule" | "new">(canReschedule ? "reschedule" : "new");
  const requestId = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), []);
  return (
    <ActionForm action={rescheduleAction} className="rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
      {(st) => (
        <>
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="mode" value={mode} />
          {canReschedule && (
            <div role="radiogroup" aria-label="O que fazer" className="mb-5 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["reschedule", "Remarcar esta visita", "A visita atual vira “Remarcada” e a nova fica no lugar."],
                  ["new", "Nova visita, mesmo cliente", "Mantém a atual e marca outra (revisita)."],
                ] as const
              ).map(([v, t, h]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={mode === v}
                  onClick={() => setMode(v)}
                  className={cx("rounded-2xl border-2 p-3.5 text-left transition", mode === v ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}
                >
                  <span className="block text-[15px] font-bold">{t}</span>
                  <span className="text-[12px] text-ink-3">{h}</span>
                </button>
              ))}
            </div>
          )}
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
