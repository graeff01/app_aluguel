"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ownerLeadUpdateAction } from "@/app/actions/owner";
import type { LeadStatus } from "@/server/owner-leads";

const NEXT: Partial<Record<LeadStatus, [LeadStatus, string][]>> = {
  NEW: [["CONTACTED", "Já falei com ele"]],
  CONTACTED: [
    ["VISITED", "Avaliei o imóvel"],
    ["CAPTURED", "Captado!"],
    ["LOST", "Não fechou"],
  ],
  VISITED: [
    ["CAPTURED", "Captado!"],
    ["LOST", "Não fechou"],
  ],
  CAPTURED: [["CONTACTED", "Reabrir"]],
  LOST: [["CONTACTED", "Reabrir"]],
};

/** "Vou atender", próximo passo e observação. */
export function LeadActions({ id, status, mine, taken, note }: { id: string; status: LeadStatus; mine: boolean; taken: boolean; note: string }) {
  const [editing, setEditing] = useState(false);
  const closed = status === "CAPTURED" || status === "LOST";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {!mine && !closed && (
        <ActionForm action={ownerLeadUpdateAction}>
          {() => (
            <>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="take" value="1" />
              <SubmitButton variant="secondary" className="min-h-10 px-4 text-[13px]">
                {taken ? "Assumir" : "Vou atender"}
              </SubmitButton>
            </>
          )}
        </ActionForm>
      )}
      {(NEXT[status] ?? []).map(([to, label]) => (
        <ActionForm key={to} action={ownerLeadUpdateAction}>
          {() => (
            <>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value={to} />
              <SubmitButton variant={to === "CAPTURED" ? "primary" : "secondary"} className="min-h-10 px-4 text-[13px]">
                {label}
              </SubmitButton>
            </>
          )}
        </ActionForm>
      ))}
      {editing ? (
        <ActionForm action={ownerLeadUpdateAction} className="basis-full">
          {() => (
            <>
              <input type="hidden" name="id" value={id} />
              <textarea name="note" defaultValue={note} rows={2} maxLength={600} placeholder="Ex.: quer R$ 2.800; desocupa dia 10; ligar sexta" className="block w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-[14px]" />
              <div className="mt-2 flex gap-2">
                <SubmitButton className="min-h-10 px-4 text-[13px]">Salvar</SubmitButton>
                <button type="button" onClick={() => setEditing(false)} className="press min-h-10 px-3 text-[13px] font-semibold text-ink-2">
                  Voltar
                </button>
              </div>
            </>
          )}
        </ActionForm>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="press inline-flex min-h-10 items-center px-2 text-[13px] font-semibold text-ink-2 hover:text-ink">
          {note ? "Editar observação" : "+ Observação"}
        </button>
      )}
    </div>
  );
}
