"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Input } from "@/components/ui";
import { wipeTestDataAction } from "@/app/actions/admin";

/** Formulário "Começar do zero": precisa ser componente do navegador porque usa o estado do envio (erro no campo). */
export function WipeForm({ phrase }: { phrase: string }) {
  return (
    <ActionForm action={wipeTestDataAction} confirm="Apagar todos os dados de teste? Não dá para desfazer." className="mt-4">
      {(st) => (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-64">
            <label htmlFor="wipe-confirm" className="mb-1.5 block text-sm font-semibold">
              Digite {phrase} para confirmar
            </label>
            <Input id="wipe-confirm" name="confirm" autoComplete="off" required />
            {st.fieldErrors?.confirm && <p className="mt-1.5 text-[13px] font-semibold text-bad">{st.fieldErrors.confirm}</p>}
          </div>
          <SubmitButton variant="danger">Apagar dados de teste</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
