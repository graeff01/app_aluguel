"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { btnVariant, cx, type BtnVariant } from "./ui";

export type ActionState = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; at?: number };
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Formulário com estado do servidor: desabilita envio duplo e exibe erro sem perder o que foi digitado. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  confirm,
}: {
  action: Action;
  children: ReactNode | ((s: ActionState) => ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {typeof children === "function" ? children(state) : children}
      {state.message && (
        <p role={state.ok ? "status" : "alert"} className={cx("mt-3 text-sm font-semibold break-words", state.ok ? "text-good" : "text-bad")}>
          {state.message}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", className, name, value }: { children: ReactNode; variant?: BtnVariant; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  const styles = btnVariant[variant];
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-disabled={pending}
      className={cx("inline-flex min-h-12 items-center justify-center rounded-full px-6 text-[15px] font-semibold tracking-[-0.01em] transition active:scale-[0.98] disabled:opacity-50", styles, className)}
    >
      {pending ? "Salvando…" : children}
    </button>
  );
}

export function FieldError({ state, name }: { state: ActionState; name: string }) {
  const msg = state.fieldErrors?.[name];
  return msg ? <p className="mt-1.5 text-[13px] font-semibold text-bad">{msg}</p> : null;
}
