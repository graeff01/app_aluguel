"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { assignVisitAction, excludeVisitAction } from "@/app/actions/visits";

export function VisitAdminTools({ visitId, consultants, currentConsultantId, excluded }: { visitId: string; consultants: { id: string; name: string }[]; currentConsultantId: string | null; excluded: boolean }) {
  return (
    <section className="mb-8 grid gap-4 lg:grid-cols-2" aria-label="Ferramentas da gestão">
      <ActionForm action={assignVisitAction} className="rounded-3xl border border-line bg-surface p-5 shadow-card">
        <h2 className="mb-3 font-semibold">Atribuição (gestão)</h2>
        <input type="hidden" name="visitId" value={visitId} />
        <Field label="Consultora responsável" htmlFor="consultantId" hint="A correção fica no histórico e a sincronização não a sobrescreve.">
          <Select id="consultantId" name="consultantId" defaultValue={currentConsultantId ?? ""} required>
            <option value="" disabled>
              Selecione
            </option>
            {consultants.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Observação (opcional)" htmlFor="assign-note">
          <Input id="assign-note" name="note" maxLength={300} />
        </Field>
        <SubmitButton variant="secondary">Salvar atribuição</SubmitButton>
      </ActionForm>
      <ActionForm action={excludeVisitAction} className="rounded-3xl border border-line bg-surface p-5 shadow-card" confirm={excluded ? undefined : "Excluir esta visita dos indicadores?"}>
        <h2 className="mb-3 font-semibold">{excluded ? "Incluir de volta nos indicadores" : "Não é visita comercial?"}</h2>
        <input type="hidden" name="visitId" value={visitId} />
        <input type="hidden" name="excluded" value={excluded ? "0" : "1"} />
        <Field label="Motivo" htmlFor="excl-note">
          <Input id="excl-note" name="note" required maxLength={300} />
        </Field>
        <SubmitButton variant={excluded ? "secondary" : "danger"}>{excluded ? "Incluir" : "Excluir dos indicadores"}</SubmitButton>
      </ActionForm>
    </section>
  );
}
