"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { anonymizeClientAction } from "@/app/actions/visits";

export function AnonymizeForm({ clientId }: { clientId: string }) {
  return (
    <ActionForm
      action={anonymizeClientAction}
      className="max-w-xl rounded-3xl border border-bad/20 bg-surface p-5 shadow-card"
      confirm="Remover nome, telefones e observações deste cliente? Não é possível desfazer. Os indicadores continuam corretos."
    >
      <input type="hidden" name="clientId" value={clientId} />
      <p className="mb-3 text-sm text-ink-2">Use quando o cliente pedir a exclusão dos dados. Remove nome, telefones e observações; datas e resultados das visitas continuam nos indicadores, sem identificar a pessoa.</p>
      <Field label="Motivo" htmlFor="reason" hint="Ex.: pedido do titular por WhatsApp em 09/10.">
        <Input id="reason" name="reason" required minLength={3} maxLength={200} />
      </Field>
      <SubmitButton variant="danger">Excluir dados pessoais</SubmitButton>
    </ActionForm>
  );
}
