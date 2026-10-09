"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { loginAction } from "@/app/actions/auth";

export function LoginForm() {
  return (
    <ActionForm action={loginAction}>
      <Field label="E-mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" required />
      </Field>
      <Field label="Senha" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full">Entrar</SubmitButton>
    </ActionForm>
  );
}
