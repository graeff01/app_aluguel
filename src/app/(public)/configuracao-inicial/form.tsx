"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { setupAction } from "@/app/actions/auth";

export function SetupForm() {
  return (
    <ActionForm action={setupAction}>
      {(s) => (
        <>
          <Field label="Código de configuração (SETUP_TOKEN)" htmlFor="setupToken">
            <Input id="setupToken" name="setupToken" type="password" required autoComplete="off" />
            <FieldError state={s} name="setupToken" />
          </Field>
          <Field label="Nome" htmlFor="name">
            <Input id="name" name="name" required autoComplete="name" />
            <FieldError state={s} name="name" />
          </Field>
          <Field label="E-mail de login" htmlFor="email">
            <Input id="email" name="email" type="email" required autoComplete="username" />
            <FieldError state={s} name="email" />
          </Field>
          <Field label="Senha" htmlFor="password" hint="Ao menos 10 caracteres.">
            <Input id="password" name="password" type="password" required autoComplete="new-password" minLength={10} />
            <FieldError state={s} name="password" />
          </Field>
          <SubmitButton className="w-full">Criar administrador</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
