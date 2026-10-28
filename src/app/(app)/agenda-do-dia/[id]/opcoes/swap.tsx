"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { swapPropertyAction } from "@/app/actions/visits";

/** Troca o imóvel da visita por esta opção (mesmo horário e cliente; o antigo fica como trocado). */
export function SwapToThis({ visitId, seenCode, newCode, reasonId }: { visitId: string; seenCode: string; newCode: string; reasonId: string }) {
  return (
    <ActionForm action={swapPropertyAction} confirm={`Trocar o imóvel ${seenCode} pelo ${newCode}, no mesmo horário? A consultora é avisada.`}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="seenCode" value={seenCode} />
      <input type="hidden" name="newCode" value={newCode} />
      <input type="hidden" name="reasonId" value={reasonId} />
      <SubmitButton className="min-h-9 px-3 text-[13px]">Trocar por este</SubmitButton>
    </ActionForm>
  );
}
