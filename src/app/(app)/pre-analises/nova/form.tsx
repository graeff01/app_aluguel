"use client";
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Textarea, cx } from "@/components/ui";
import { createPreAnalysisAction } from "@/app/actions/pre-analysis";

const cpfMask = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
};

type QueueItem = { id: string; name: string; lastAt: Date | null; monthCount: number; isNext: boolean; isLast: boolean };

const ago = (d: Date) => {
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
};

export function PreAnalysisForm({ consultants }: { consultants: QueueItem[] }) {
  const [cpf, setCpf] = useState("");
  const [chosen, setChosen] = useState(consultants.find((c) => c.isNext)?.id ?? "");
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
          <fieldset className="mb-5">
            <legend className="mb-1 text-sm font-semibold text-ink">Encaminhar para a consultora</legend>
            <p className="mb-3 text-[13px] text-ink-3">Rodízio: a próxima da vez já vem escolhida. Toque em outra se precisar.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {consultants.map((c) => {
                const on = chosen === c.id;
                return (
                  <label
                    key={c.id}
                    className={cx(
                      "press relative flex cursor-pointer items-center gap-3 rounded-[22px] border-2 bg-surface p-4 transition",
                      on ? "border-accent shadow-[0_10px_24px_-14px_var(--accent)]" : "border-line hover:border-line-strong",
                    )}
                  >
                    <input type="radio" name="consultantId" value={c.id} checked={on} onChange={() => setChosen(c.id)} className="sr-only" required />
                    <span className={cx("grid size-12 shrink-0 place-items-center rounded-full text-[15px] font-bold", on ? "bg-accent text-white" : "bg-tint text-ink")}>
                      {c.name
                        .split(" ")
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px] font-bold">{c.name}</span>
                      <span className="block text-[12px] text-ink-3">
                        {c.lastAt ? `Recebeu ${ago(c.lastAt)}` : "Ainda não recebeu"} · {c.monthCount} no mês
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.isNext && <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-white">Próxima da vez</span>}
                        {c.isLast && <span className="rounded-full bg-tint px-2.5 py-0.5 text-[11px] font-bold text-ink-2">Última a receber</span>}
                      </span>
                    </span>
                    <span aria-hidden className={cx("grid size-6 shrink-0 place-items-center rounded-full border-2", on ? "border-accent bg-accent text-white" : "border-line-strong")}>
                      {on && (
                        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3}>
                          <path d="M5 12.5l4.5 4.5L19 7" />
                        </svg>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            {st.fieldErrors?.consultantId && <p className="mt-1.5 text-[13px] font-semibold text-bad">{st.fieldErrors.consultantId}</p>}
            {chosen && !consultants.find((c) => c.id === chosen)?.isNext && <p className="mt-2 text-[13px] font-semibold text-accent-strong">Fora do rodízio: pela vez, seria {consultants.find((c) => c.isNext)?.name.split(" ")[0]}.</p>}
          </fieldset>
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
