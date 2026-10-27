"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Textarea } from "@/components/ui";
import { dealNoteAction } from "@/app/actions/visits";

/** Anotar o andamento sem mudar de etapa (ex.: "liguei, o cliente vai pensar até sexta"). */
export function DealNoteForm({ oppId, stageLabel }: { oppId: string; stageLabel: string }) {
  return (
    <ActionForm action={dealNoteAction} className="max-w-2xl rounded-3xl border border-line bg-surface p-5 shadow-card">
      {(s) => (
        <>
          <input type="hidden" name="oppId" value={oppId} />
          <label htmlFor="deal-update" className="mb-1.5 block text-sm font-semibold">
            O que aconteceu? <span className="font-normal text-ink-3">(continua em “{stageLabel}”)</span>
          </label>
          <Textarea id="deal-update" name="note" required minLength={3} maxLength={2000} rows={3} placeholder="Ex.: falei com o cliente, ele vai decidir até sexta." />
          <FieldError state={s} name="note" />
          <div className="mt-3">
            <SubmitButton>Salvar atualização</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
