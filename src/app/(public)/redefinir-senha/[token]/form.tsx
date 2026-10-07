"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { resetPasswordAction } from "@/app/actions/auth";

export function ResetForm({ token }: { token: string }) {
  return (
    <ActionForm action={resetPasswordAction}>
      {(s) => (
        <>
          <input type="hidden" name="token" value={token} />
          <Field label="Nova senha" htmlFor="password" hint="Ao menos 10 caracteres.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
            <FieldError state={s} name="password" />
          </Field>
          <Field label="Confirme a senha" htmlFor="confirm">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            <FieldError state={s} name="confirm" />
          </Field>
          <SubmitButton className="w-full">Salvar senha</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
