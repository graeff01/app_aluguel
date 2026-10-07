"use client";
import { ActionForm, FieldError, SubmitButton } from "./action-form";
import { Field, Input } from "./ui";
import { setInitialPasswordAction } from "@/app/actions/auth";

/** Janela bloqueante no primeiro acesso com senha provisória. */
export function ForcePasswordDialog({ name }: { name: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1f2124]/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="fp-title">
      <div className="w-full max-w-md rounded-3xl bg-surface p-6 shadow-float sm:p-8">
        <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase">Primeiro acesso</p>
        <h2 id="fp-title" className="text-[24px] leading-tight font-bold tracking-[-0.03em]">
          Olá, {name.split(" ")[0]}. Crie sua senha.
        </h2>
        <p className="mt-2 mb-6 text-sm text-ink-2">Você entrou com uma senha provisória. Escolha uma senha pessoal para continuar — a provisória deixa de valer na hora.</p>
        <ActionForm action={setInitialPasswordAction}>
          {(s) => (
            <>
              <Field label="Nova senha" htmlFor="fp-password" hint="Ao menos 10 caracteres.">
                <Input id="fp-password" name="password" type="password" autoComplete="new-password" required minLength={10} autoFocus />
                <FieldError state={s} name="password" />
              </Field>
              <Field label="Confirme a nova senha" htmlFor="fp-confirm">
                <Input id="fp-confirm" name="confirm" type="password" autoComplete="new-password" required />
                <FieldError state={s} name="confirm" />
              </Field>
              <SubmitButton className="w-full">Salvar e continuar</SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </div>
  );
}
