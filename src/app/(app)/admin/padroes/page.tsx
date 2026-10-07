import { requireAdmin } from "@/lib/require";
import { db } from "@/lib/db";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { InlineAction } from "@/components/inline-action";
import { Badge, Field, Input, PageHeader, Section, Select } from "@/components/ui";
import { patternAction } from "@/app/actions/admin";

export const metadata = { title: "Padrões de eventos" };

const KIND = {
  VISIT_PREFIX: { title: "Início do título que identifica visita", hint: "Ex.: “visita clt”, “visita video”. O evento é importado como visita." },
  EXCLUDE: { title: "Termos que excluem o evento", hint: "Ex.: “visita tecnica”, “almoco”, “reuniao”. Não é importado nem guardado." },
  AMBIGUOUS: { title: "Termos que enviam para revisão", hint: "Ex.: “visita”, “cod”. A gestão decide se é visita." },
} as const;

export default async function PatternsPage() {
  await requireAdmin();
  const patterns = await db.eventPattern.findMany({ orderBy: [{ kind: "asc" }, { pattern: "asc" }] });
  return (
    <>
      <PageHeader title="Padrões de eventos" subtitle="Comparação sem maiúsculas, acentos ou espaços extras. Ordem: visita → exclusão → revisão. Os demais eventos são ignorados." />
      {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => (
        <Section key={k} title={KIND[k].title}>
          <p className="mb-2 text-sm text-ink-3">{KIND[k].hint}</p>
          <ul className="mb-3 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
            {patterns
              .filter((p) => p.kind === k)
              .map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <span>
                    <code className={p.active ? "" : "text-ink-3 line-through"}>{p.pattern}</code> {!p.active && <Badge>Inativo</Badge>}
                  </span>
                  <span className="flex gap-1">
                    <InlineAction action={patternAction} fields={{ op: "toggle", patternId: p.id }} label={p.active ? "Desativar" : "Ativar"} />
                    <InlineAction action={patternAction} fields={{ op: "delete", patternId: p.id }} label="Excluir" variant="danger" confirm="Excluir este padrão?" />
                  </span>
                </li>
              ))}
          </ul>
        </Section>
      ))}
      <Section title="Adicionar padrão">
        <ActionForm action={patternAction} resetOnSuccess className="max-w-xl rounded-3xl border border-line bg-surface p-5 shadow-card">
          <input type="hidden" name="op" value="create" />
          <Field label="Tipo" htmlFor="kind">
            <Select id="kind" name="kind">
              <option value="VISIT_PREFIX">Identifica visita (início do título)</option>
              <option value="EXCLUDE">Exclui evento</option>
              <option value="AMBIGUOUS">Envia para revisão</option>
            </Select>
          </Field>
          <Field label="Texto" htmlFor="pattern">
            <Input id="pattern" name="pattern" required minLength={2} maxLength={60} />
          </Field>
          <SubmitButton>Adicionar</SubmitButton>
        </ActionForm>
      </Section>
    </>
  );
}
