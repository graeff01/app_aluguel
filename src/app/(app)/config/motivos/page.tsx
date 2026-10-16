import { requireManager } from "@/lib/require";
import { db } from "@/lib/db";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { InlineAction } from "@/components/inline-action";
import { Badge, Input, PageHeader, Section } from "@/components/ui";
import { reasonAction } from "@/app/actions/admin";
import { REASON_GROUPS, REASON_USAGE, reasonUsage } from "@/lib/reasons";

export const metadata = { title: "Listas e motivos" };

export default async function ReasonsPage() {
  await requireManager();
  const reasons = await db.reason.findMany({ include: { _count: { select: REASON_USAGE } }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] });
  const groups = REASON_GROUPS;
  return (
    <>
      <PageHeader title="Listas e motivos" subtitle="Itens já usados não podem ser excluídos — desative-os para preservar o histórico." />
      {groups.map((g) => (
        <Section key={g.kind} title={g.title} id={g.kind === "LEASE_AGENT" ? "agenciadores" : undefined}>
          <ul className="mb-3 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
            {reasons
              .filter((r) => r.kind === g.kind)
              .map((r) => {
                const used = reasonUsage(r._count);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span>
                      <span className={r.active ? "font-medium" : "text-ink-3 line-through"}>{r.label}</span>{" "}
                      <span className="text-sm text-ink-3">· usado {used}×</span> {!r.active && <Badge>Inativo</Badge>}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <InlineAction action={reasonAction} fields={{ op: "up", reasonId: r.id }} label="↑" />
                      <InlineAction action={reasonAction} fields={{ op: "down", reasonId: r.id }} label="↓" />
                      <InlineAction action={reasonAction} fields={{ op: "toggle", reasonId: r.id }} label={r.active ? "Desativar" : "Reativar"} />
                      {used === 0 && <InlineAction action={reasonAction} fields={{ op: "delete", reasonId: r.id }} label="Excluir" variant="danger" confirm="Excluir este motivo?" />}
                    </span>
                  </li>
                );
              })}
          </ul>
          <ActionForm action={reasonAction} resetOnSuccess className="flex max-w-xl flex-wrap items-end gap-2">
            <input type="hidden" name="op" value="create" />
            <input type="hidden" name="kind" value={g.kind} />
            <label className="sr-only" htmlFor={`new-${g.kind}`}>
              Novo motivo
            </label>
            <Input id={`new-${g.kind}`} name="label" placeholder={g.placeholder} required maxLength={80} className="flex-1" />
            <SubmitButton variant="secondary">Adicionar</SubmitButton>
          </ActionForm>
        </Section>
      ))}
    </>
  );
}
