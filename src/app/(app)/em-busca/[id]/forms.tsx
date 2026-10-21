"use client";
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea, cx } from "@/components/ui";
import { closeSearchAction, logSearchContactAction, updateSearchProfileAction } from "@/app/actions/client-search";

type Profile = { maxBudget: string; areas: string; propertyType: string; bedrooms: string; mustNot: string; note: string };

export function ProfileForm({ id, types, initial }: { id: string; types: string[]; initial: Profile }) {
  return (
    <ActionForm action={updateSearchProfileAction}>
      {(st) => (
        <>
          <input type="hidden" name="id" value={id} />
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label="Até quanto pode pagar (total)" htmlFor="maxBudget" hint="Aluguel + condomínio + IPTU.">
              <Input id="maxBudget" name="maxBudget" inputMode="decimal" placeholder="Ex.: 2.500" defaultValue={initial.maxBudget} />
              <FieldError state={st} name="maxBudget" />
            </Field>
            <Field label="Regiões ou bairros" htmlFor="areas" hint="Separe por vírgula.">
              <Input id="areas" name="areas" placeholder="Ex.: Centro, Marechal Rondon" defaultValue={initial.areas} />
            </Field>
            <Field label="Tipo" htmlFor="propertyType">
              <Select id="propertyType" name="propertyType" defaultValue={initial.propertyType}>
                <option value="">Qualquer</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quartos (mínimo)" htmlFor="bedrooms">
              <Select id="bedrooms" name="bedrooms" defaultValue={initial.bedrooms}>
                <option value="">Tanto faz</option>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}+
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="O que não quer" htmlFor="mustNot" hint="O que aprendeu nas visitas. Ex.: sem escadas, precisa aceitar pet.">
            <Input id="mustNot" name="mustNot" maxLength={300} defaultValue={initial.mustNot} />
          </Field>
          <Field label="Anotações" htmlFor="note">
            <Textarea id="note" name="note" rows={4} maxLength={1500} defaultValue={initial.note} />
          </Field>
          <SubmitButton variant="secondary">Salvar perfil</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

const WHEN: [number | null, string][] = [
  [1, "Amanhã"],
  [3, "Em 3 dias"],
  [7, "Em 1 semana"],
  [null, "Sem data"],
];

export function ContactForm({ id }: { id: string }) {
  const [days, setDays] = useState<number | null>(3);
  return (
    <ActionForm action={logSearchContactAction} resetOnSuccess>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="followUpDays" value={days ?? ""} />
      <Textarea name="contactNote" rows={2} maxLength={300} placeholder="Ex.: Mandei 3 opções no WhatsApp; gostou do 761739." aria-label="O que conversaram" />
      <p className="mt-3 mb-2 text-[14px] font-semibold">Falar de novo</p>
      <div className="mb-4 grid grid-cols-4 gap-2">
        {WHEN.map(([d, l]) => (
          <button key={String(d)} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={cx("min-h-11 rounded-2xl border-2 text-[13px] font-semibold", days === d ? "border-accent bg-accent-soft" : "border-line")}>
            {l}
          </button>
        ))}
      </div>
      <SubmitButton>Registrar contato</SubmitButton>
    </ActionForm>
  );
}

export function CloseForm({ id }: { id: string }) {
  return (
    <ActionForm action={closeSearchAction} confirm="Encerrar a busca deste cliente?">
      {(st) => (
        <>
          <input type="hidden" name="id" value={id} />
          <fieldset className="mb-3 grid gap-2 sm:grid-cols-3">
            <legend className="sr-only">Como terminou</legend>
            {[
              ["WON", "Alugou conosco"],
              ["LOST_ELSEWHERE", "Alugou em outro lugar"],
              ["GAVE_UP", "Desistiu / não responde"],
            ].map(([v, l]) => (
              <label key={v} className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 text-[14px] font-semibold has-[:checked]:border-primary">
                <input type="radio" name="outcome" value={v} required className="size-4.5 accent-[var(--accent)]" />
                {l}
              </label>
            ))}
          </fieldset>
          <FieldError state={st} name="outcome" />
          <Input name="closeNote" maxLength={300} placeholder="Observação (opcional)" aria-label="Observação" />
          <SubmitButton variant="secondary" className="mt-3">
            Encerrar busca
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
