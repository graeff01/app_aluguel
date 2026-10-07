import Link from "next/link";
import { notFound } from "next/navigation";
import { requireManager } from "@/lib/require";
import { canManageUser, isAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { fmt } from "@/lib/time";
import { ROLE_LABEL } from "@/lib/labels";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { InlineAction } from "@/components/inline-action";
import { Field, Input, PageHeader, Section, Select } from "@/components/ui";
import { addAliasAction, removeAliasAction, resetLinkAction, updateUserAction } from "@/app/actions/admin";

export const metadata = { title: "Usuário" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireManager();
  const { id } = await params;
  const u = await db.user.findUnique({ where: { id }, include: { aliases: true, _count: { select: { visits: true, sessions: true } } } });
  if (!u) notFound();
  const editable = canManageUser(actor, u.role);
  return (
    <>
      <Link href="/config/usuarios" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Usuários
      </Link>
      <PageHeader title={u.name} subtitle={`${ROLE_LABEL[u.role]} · ${u.email} · ${u._count.visits} visitas · ${u.active ? "ativo" : `desativado em ${u.deactivatedAt ? fmt.date(u.deactivatedAt) : "—"}`}`} />
      {!editable ? (
        <p className="text-ink-2">Somente o administrador pode alterar este usuário.</p>
      ) : (
        <>
          <Section title="Dados e acesso">
            <ActionForm action={updateUserAction} className="max-w-xl rounded-3xl border border-line bg-surface p-5 shadow-card">
              <input type="hidden" name="userId" value={u.id} />
              <Field label="Nome" htmlFor="name">
                <Input id="name" name="name" defaultValue={u.name} />
              </Field>
              <Field label="Papel" htmlFor="role">
                <Select id="role" name="role" defaultValue={u.role} disabled={!isAdmin(actor)}>
                  <option value="CONSULTANT">Consultora</option>
                  <option value="MANAGER">Gestora</option>
                  <option value="ADMIN">Administrador(a)</option>
                </Select>
                {!isAdmin(actor) && <input type="hidden" name="role" value={u.role} />}
              </Field>
              <Field label="Acesso" htmlFor="active" hint="Desativar revoga o acesso imediatamente e preserva todo o histórico.">
                <Select id="active" name="active" defaultValue={u.active ? "1" : "0"}>
                  <option value="1">Ativo</option>
                  <option value="0">Desativado</option>
                </Select>
              </Field>
              <SubmitButton>Salvar</SubmitButton>
            </ActionForm>
          </Section>
          <Section title="E-mails reconhecidos na agenda">
            <div className="max-w-xl rounded-3xl border border-line bg-surface p-5 shadow-card">
              {u.role !== "CONSULTANT" && <p className="mb-3 text-sm text-ink-3">Somente e-mails de consultoras ativas atribuem visitas. Gestora e organizadora convidadas não são consultoras.</p>}
              <ul className="mb-4 space-y-2">
                {u.aliases.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="break-all">{a.email}</span>
                    <InlineAction action={removeAliasAction} fields={{ aliasId: a.id }} label="Remover" variant="danger" confirm="Remover este e-mail do mapeamento?" />
                  </li>
                ))}
                {u.aliases.length === 0 && <li className="text-ink-3">Nenhum e-mail vinculado.</li>}
              </ul>
              <ActionForm action={addAliasAction} resetOnSuccess>
                <input type="hidden" name="userId" value={u.id} />
                <Field label="Adicionar e-mail" htmlFor="alias">
                  <Input id="alias" name="email" type="email" required />
                </Field>
                <SubmitButton variant="secondary">Vincular</SubmitButton>
              </ActionForm>
            </div>
          </Section>
          <Section title="Senha">
            <div className="max-w-xl rounded-3xl border border-line bg-surface p-5 shadow-card">
              <p className="mb-3 text-ink-2">Gere um link de uso único (24 h) e envie à pessoa por um canal seguro.</p>
              <ActionForm action={resetLinkAction}>
                <input type="hidden" name="userId" value={u.id} />
                <SubmitButton variant="secondary">Gerar link de redefinição</SubmitButton>
              </ActionForm>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
