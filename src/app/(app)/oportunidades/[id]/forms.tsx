"use client";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { transferOpportunityAction } from "@/app/actions/visits";

export function TransferForm({ oppId, users, current }: { oppId: string; users: { id: string; name: string }[]; current: string | null }) {
  return (
    <ActionForm action={transferOpportunityAction} className="max-w-xl rounded-3xl border border-line bg-surface p-5 shadow-card">
      <input type="hidden" name="oppId" value={oppId} />
      <Field label="Nova responsável" htmlFor="responsibleId" hint="O histórico e fechamentos anteriores são preservados.">
        <Select id="responsibleId" name="responsibleId" defaultValue={current ?? ""} required>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Observação" htmlFor="tr-note">
        <Input id="tr-note" name="note" maxLength={300} />
      </Field>
      <SubmitButton variant="secondary">Transferir</SubmitButton>
    </ActionForm>
  );
}
