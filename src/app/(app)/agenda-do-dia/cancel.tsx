"use client";
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Select, Textarea } from "@/components/ui";
import { cancelVisitAction } from "@/app/actions/visits";

/** Pré-atendimento: cancelar a visita escolhendo o motivo (a consultora é avisada). */
export function CancelVisit({ visitId, label, reasons }: { visitId: string; label: string; reasons: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="press min-h-9 rounded-full border border-bad/30 px-3 text-[12px] font-semibold text-bad hover:bg-bad-soft">
        Cancelar
      </button>
    );
  }
  return (
    <ActionForm action={cancelVisitAction} className="mt-2 w-full rounded-2xl border border-bad/25 bg-bad-soft/40 p-3">
      {(s) => (
        <>
          <input type="hidden" name="visitId" value={visitId} />
          <p className="mb-2 text-[13px] font-semibold">Cancelar a visita de {label}?</p>
          <label className="sr-only" htmlFor={`reason-${visitId}`}>
            Motivo do cancelamento
          </label>
          <Select id={`reason-${visitId}`} name="reasonId" required defaultValue="">
            <option value="" disabled>
              Motivo do cancelamento
            </option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <FieldError state={s} name="reasonId" />
          <label className="sr-only" htmlFor={`note-${visitId}`}>
            Observação
          </label>
          <Textarea id={`note-${visitId}`} name="note" maxLength={500} placeholder="Observação (obrigatória se o motivo for Outro)" className="mt-2 min-h-16" />
          <FieldError state={s} name="note" />
          <div className="mt-2 flex flex-wrap gap-2">
            <SubmitButton variant="danger">Cancelar visita</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="press min-h-11 rounded-full px-4 text-[14px] font-semibold text-ink-2">
              Voltar
            </button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
