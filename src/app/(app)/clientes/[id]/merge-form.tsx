"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { mergeClientsAction } from "@/app/actions/visits";

export function MergeForm({ sourceId, suggestions }: { sourceId: string; suggestions: { id: string; name: string }[] }) {
  return (
    <ActionForm action={mergeClientsAction} className="max-w-xl rounded-3xl border border-line bg-surface p-5 shadow-card" confirm="Unir este cadastro ao cadastro de destino? Visitas e oportunidades serão movidas. A operação fica na auditoria.">
      <input type="hidden" name="sourceId" value={sourceId} />
      <p className="mb-3 text-ink-2">Use quando dois cadastros forem a mesma pessoa. Nunca una apenas pelo nome.</p>
      {suggestions.length > 0 && (
        <p className="mb-3 text-sm">
          Cadastros com o mesmo telefone:{" "}
          {suggestions.map((s) => (
            <a key={s.id} href={`/clientes/${s.id}`} className="mr-2 text-primary underline">
              {s.name} ({s.id.slice(-6)})
            </a>
          ))}
        </p>
      )}
      <Field label="ID do cadastro de destino" htmlFor="targetId" hint="Copie o identificador da URL do cadastro principal (/clientes/ID).">
        <Input id="targetId" name="targetId" required list="merge-suggestions" defaultValue={suggestions.length === 1 ? suggestions[0].id : ""} />
        <datalist id="merge-suggestions">
          {suggestions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </datalist>
      </Field>
      <SubmitButton variant="secondary">Unir a este destino</SubmitButton>
    </ActionForm>
  );
}
