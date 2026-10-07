"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Input, Select } from "@/components/ui";
import { ambiguousAction, assignVisitAction, distinctClientAction, linkClientAction, resolveConflictAction } from "@/app/actions/visits";

export function AssignInline({ visitId, consultants }: { visitId: string; consultants: { id: string; name: string }[] }) {
  return (
    <ActionForm action={assignVisitAction} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="visitId" value={visitId} />
      <label className="sr-only" htmlFor={`as-${visitId}`}>
        Consultora
      </label>
      <Select id={`as-${visitId}`} name="consultantId" required defaultValue="" className="max-w-xs">
        <option value="" disabled>
          Escolher consultora
        </option>
        {consultants.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <SubmitButton variant="secondary">Atribuir</SubmitButton>
    </ActionForm>
  );
}

export function ConflictInline({ visitId, conflict, canMerge }: { visitId: string; conflict: string; canMerge: boolean }) {
  return (
    <ActionForm action={resolveConflictAction} className="mt-3">
      <input type="hidden" name="visitId" value={visitId} />
      <label className="mb-1 block text-sm font-medium" htmlFor={`cn-${visitId}`}>
        Observação
      </label>
      <Input id={`cn-${visitId}`} name="note" maxLength={300} placeholder="Opcional (obrigatória para marcar cancelada)" />
      <div className="mt-2 flex flex-wrap gap-2">
        <SubmitButton variant="secondary" name="action" value="KEEP">
          Manter dados e resultado do app
        </SubmitButton>
        {conflict === "CHANGED_AFTER_CONCLUSION" && (
          <SubmitButton variant="secondary" name="action" value="APPLY_GOOGLE">
            Aplicar dados da agenda
          </SubmitButton>
        )}
        {(conflict === "CANCELED_IN_GOOGLE" || conflict === "DELETED_IN_GOOGLE") && (
          <SubmitButton variant="danger" name="action" value="MARK_CANCELED">
            Marcar como cancelada
          </SubmitButton>
        )}
        {conflict === "POSSIBLE_RECREATION" && canMerge && (
          <SubmitButton variant="secondary" name="action" value="MERGE_RECREATION">
            É a mesma visita — unir
          </SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}

export function AmbiguousInline({ id }: { id: string }) {
  return (
    <ActionForm action={ambiguousAction} className="mt-3 flex flex-wrap gap-2">
      <input type="hidden" name="sourceEventId" value={id} />
      <SubmitButton name="decision" value="accept">
        É visita comercial
      </SubmitButton>
      <SubmitButton variant="secondary" name="decision" value="reject">
        Não é visita
      </SubmitButton>
    </ActionForm>
  );
}

export function ClientLinkInline({ visitId, candidates }: { visitId: string; candidates: { id: string; name: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {candidates.map((c) => (
        <ActionForm key={c.id} action={linkClientAction}>
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="clientId" value={c.id} />
          <SubmitButton variant="secondary">Mesma pessoa que “{c.name}”</SubmitButton>
        </ActionForm>
      ))}
      <ActionForm action={distinctClientAction}>
        <input type="hidden" name="visitId" value={visitId} />
        <SubmitButton variant="secondary">Pessoa diferente</SubmitButton>
      </ActionForm>
    </div>
  );
}
