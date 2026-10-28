"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Input } from "@/components/ui";
import { captureFoundAction } from "@/app/actions/radar";

/** "Achei imóvel": código(s) e uma observação; vai para o pré-atendimento. */
export function CaptureFoundForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="press mt-3 inline-flex min-h-10 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary">
        Achei imóvel
      </button>
    );
  return (
    <ActionForm action={captureFoundAction} resetOnSuccess className="mt-3 rounded-2xl border border-line bg-surface-2 p-3">
      {(s) => (
        <>
          <input type="hidden" name="id" value={id} />
          <label htmlFor={`codes-${id}`} className="mb-1 block text-[13px] font-semibold">
            Código do imóvel <span className="font-normal text-ink-3">(vários: separe com ;)</span>
          </label>
          <Input id={`codes-${id}`} name="codes" required inputMode="numeric" autoComplete="off" placeholder="734999" />
          {s.fieldErrors?.codes && <p className="mt-1 text-[13px] font-semibold text-bad">{s.fieldErrors.codes}</p>}
          <label htmlFor={`note-${id}`} className="mt-2 mb-1 block text-[13px] font-semibold">
            Observação <span className="font-normal text-ink-3">(opcional)</span>
          </label>
          <Input id={`note-${id}`} name="note" maxLength={500} placeholder="Ex.: entra no site amanhã; proprietário aceita pet" />
          <div className="mt-3 flex flex-wrap gap-2">
            <SubmitButton>Enviar ao pré-atendimento</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="press min-h-11 rounded-full px-4 text-[14px] font-semibold text-ink-2">
              Voltar
            </button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
