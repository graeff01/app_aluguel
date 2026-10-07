"use client";
import { ActionForm, SubmitButton, type ActionState } from "./action-form";
import type { BtnVariant } from "./ui";

export function InlineAction({ action, fields, label, variant = "secondary", confirm }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; fields: Record<string, string>; label: string; variant?: BtnVariant; confirm?: string }) {
  return (
    <ActionForm action={action} confirm={confirm} className="inline">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} className="min-h-10 px-3 text-sm">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
