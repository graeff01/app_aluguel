"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { changePasswordAction } from "@/app/actions/auth";

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="max-w-md rounded-3xl border border-line bg-surface p-5 shadow-card">
      {(s) => (
        <>
          <Field label="Senha atual" htmlFor="current">
            <Input id="current" name="current" type="password" autoComplete="current-password" required />
            <FieldError state={s} name="current" />
          </Field>
          <Field label="Nova senha" htmlFor="password" hint="Ao menos 10 caracteres.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
            <FieldError state={s} name="password" />
          </Field>
          <Field label="Confirme a nova senha" htmlFor="confirm">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            <FieldError state={s} name="confirm" />
          </Field>
          <SubmitButton variant="secondary">Alterar senha</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
