"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Textarea } from "@/components/ui";
import { demoFeedbackAction } from "@/app/actions/demo";

/** Sugestões de melhoria (vão para a gestão ler no app). */
export function DemoFeedback() {
  return (
    <section className="mt-10 rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <h2 className="text-[17px] font-bold">O que você mudaria ou acrescentaria?</h2>
      <p className="mb-4 text-[14px] text-ink-3">Sua sugestão chega direto para a equipe que está construindo o app.</p>
      <ActionForm action={demoFeedbackAction} resetOnSuccess>
        {(s) => (
          <>
            <input type="hidden" name="demo" value="captacao" />
            <Field label="Seu nome (opcional)" htmlFor="fb-name">
              <Input id="fb-name" name="name" maxLength={80} autoComplete="name" />
            </Field>
            <Field label="Sugestão" htmlFor="fb-text" error={s.fieldErrors?.text}>
              <Textarea id="fb-text" name="text" rows={4} maxLength={2000} required placeholder="Ex.: queria ver também o valor do condomínio que o cliente aceita; avisar por e-mail; filtrar pedidos por bairro…" />
            </Field>
            <SubmitButton>Enviar sugestão</SubmitButton>
          </>
        )}
      </ActionForm>
    </section>
  );
}
