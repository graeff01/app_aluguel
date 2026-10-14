"use client";
import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea, cx } from "@/components/ui";
import { PropertyLookup } from "@/components/property-lookup";
import { rescheduleAction } from "@/app/actions/visits";

type Outcome = "RESCHEDULED" | "NO_SHOW" | "DONE";
type Evaluation = "POSITIVE" | "UNDECIDED" | "NEGATIVE";

/**
 * Passo 1 (visita em aberto): o que aconteceu com ESTA visita — ela nunca fica em aberto.
 * Passo 2: a nova visita (data, horário, imóvel — pode trocar o código; mesmo cliente).
 */
export function RescheduleForm(p: {
  visitId: string;
  open: boolean;
  canComplete: boolean;
  unlockLabel: string;
  defaultDate: string;
  defaultTime: string;
  defaultDuration: number;
  propertyCode: string;
  reasons: { id: string; label: string }[];
}) {
  const [outcome, setOutcome] = useState<Outcome>("RESCHEDULED");
  const [evaluation, setEvaluation] = useState<Evaluation | "">("");
  const [code, setCode] = useState(p.propertyCode);
  const requestId = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), []);
  const OUTCOMES: { v: Outcome; t: string; h: string; needsStart: boolean }[] = [
    { v: "RESCHEDULED", t: "Remarcada", h: "Não aconteceu: o cliente pediu outra data.", needsStart: false },
    { v: "NO_SHOW", t: "Cliente não compareceu", h: "Vai tentar de novo em outro horário.", needsStart: true },
    { v: "DONE", t: "Aconteceu", h: "O cliente quer outra visita (voltar ou ver outro imóvel).", needsStart: true },
  ];
  const needNote = p.open && outcome !== "RESCHEDULED";
  return (
    <ActionForm action={rescheduleAction} className="space-y-5">
      {(st) => (
        <>
          <input type="hidden" name="visitId" value={p.visitId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="mode" value={p.open ? "reschedule" : "new"} />

          {p.open && (
            <section className="rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
              <p className="mb-1 text-[12px] font-bold tracking-[0.12em] text-accent-strong uppercase">Passo 1</p>
              <h2 className="mb-3 text-[17px] font-bold">O que aconteceu com esta visita?</h2>
              <input type="hidden" name="outcomeStatus" value={outcome} />
              <div role="radiogroup" aria-label="Situação da visita atual" className="grid gap-2">
                {OUTCOMES.map((o) => {
                  const disabled = o.needsStart && !p.canComplete;
                  return (
                    <button
                      key={o.v}
                      type="button"
                      role="radio"
                      aria-checked={outcome === o.v}
                      disabled={disabled}
                      onClick={() => setOutcome(o.v)}
                      className={cx(
                        "rounded-2xl border-2 p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                        outcome === o.v ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
                      )}
                    >
                      <span className="block text-[15px] font-bold">{o.t}</span>
                      <span className="text-[12px] text-ink-3">{disabled ? `Disponível a partir das ${p.unlockLabel}` : o.h}</span>
                    </button>
                  );
                })}
              </div>
              {outcome === "DONE" && (
                <div className="mt-4">
                  <p className="mb-2 text-sm font-semibold">Como foi?</p>
                  <input type="hidden" name="evaluation" value={evaluation} />
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["POSITIVE", "Positiva"],
                        ["UNDECIDED", "Decidindo"],
                        ["NEGATIVE", "Negativa"],
                      ] as const
                    ).map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setEvaluation(v)} aria-pressed={evaluation === v} className={cx("min-h-11 rounded-2xl border-2 text-[14px] font-semibold", evaluation === v ? "border-accent bg-accent-soft" : "border-line")}>
                        {l}
                      </button>
                    ))}
                  </div>
                  {evaluation === "NEGATIVE" && (
                    <div className="mt-3">
                      <Field label="Motivo principal" htmlFor="negativeReasonId">
                        <Select id="negativeReasonId" name="negativeReasonId" defaultValue="" required>
                          <option value="" disabled>
                            Escolha…
                          </option>
                          {p.reasons.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-4">
                <Field label={needNote ? "Observação (obrigatória)" : "Motivo (opcional)"} htmlFor="outcomeNote" error={st.fieldErrors?.note} hint={needNote ? "O que o cliente disse? Fica no registro desta visita." : "Ex.: cliente pediu outro dia."}>
                  <Textarea id="outcomeNote" name="outcomeNote" rows={2} maxLength={1000} required={needNote} />
                </Field>
              </div>
            </section>
          )}

          <section className="rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
            {p.open && <p className="mb-1 text-[12px] font-bold tracking-[0.12em] text-accent-strong uppercase">Passo 2</p>}
            <h2 className="mb-3 text-[17px] font-bold">Nova visita</h2>
            <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">
              <Field label="Data" htmlFor="date" error={st.fieldErrors?.scheduledStart}>
                <Input id="date" name="date" type="date" defaultValue={p.defaultDate} required />
              </Field>
              <Field label="Horário" htmlFor="time">
                <Input id="time" name="time" type="time" defaultValue={p.defaultTime} required />
              </Field>
              <Field label="Duração" htmlFor="duration">
                <Select id="duration" name="duration" defaultValue={String(p.defaultDuration)}>
                  {[30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>
                      {({ 30: "30 min", 45: "45 min", 60: "1 h", 90: "1h30", 120: "2 h" } as Record<number, string>)[m]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Código do imóvel" htmlFor="propertyCode" error={st.fieldErrors?.propertyCode} hint={code.includes(";") ? "Vários imóveis (separados por ;): uma visita para cada, no mesmo horário. Tire o código que o cliente não vai ver." : code.trim() && code.trim() !== p.propertyCode ? `Outro imóvel: a nova visita e a agenda vão com o ${code.trim()}, mesmo cliente.` : "Mesmo imóvel. Troque o código se o cliente for ver outro (vários: separe com ;)."}>
              <Input id="propertyCode" name="propertyCode" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required />
              <PropertyLookup code={code.split(/[;,]/).map((c) => c.trim()).filter(Boolean).at(-1) ?? ""} />
            </Field>
          </section>

          {st.fieldErrors?.allowOverlap && (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[14px] text-warn">
              <input type="checkbox" name="allowOverlap" value="1" className="mt-0.5 size-5" />
              <span>
                <strong>Marcar mesmo assim</strong> nesse horário (ex.: as duas visitas são no mesmo prédio).
              </span>
            </label>
          )}
          {st.message && !st.ok && <p className="text-center text-sm font-semibold text-bad">{st.message}</p>}
          <SubmitButton className="w-full">Salvar e preparar a agenda</SubmitButton>
          <p className="text-center text-[12px] text-ink-3">No próximo passo, um toque abre o Google Agenda com tudo preenchido.</p>
        </>
      )}
    </ActionForm>
  );
}
