import Link from "next/link";
import { requireManager } from "@/lib/require";
import { isAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/labels";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Field, Input, PageHeader, Section, Select } from "@/components/ui";
import { createUserAction } from "@/app/actions/admin";

export const metadata = { title: "Usuários" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ desativados?: string; desativado?: string }> }) {
  const actor = await requireManager();
  const sp = await searchParams;
  const showInactive = sp.desativados === "1";
  // desativados saem da lista (o histórico continua ligado a eles); ficam acessíveis só pelo link no rodapé
  const [users, inactive] = await Promise.all([
    db.user.findMany({ where: { active: !showInactive }, include: { aliases: true }, orderBy: [{ role: "asc" }, { name: "asc" }] }),
    db.user.count({ where: { active: false } }),
  ]);
  return (
    <>
      <PageHeader title="Usuários" subtitle="Cadastro fechado. Consultoras são reconhecidas na agenda pelos e-mails vinculados (não pela cor ou nome)." />
      {sp.desativado && (
        <div role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">
          Usuário desativado e removido da lista. Sessões encerradas; histórico preservado.
        </div>
      )}
      <Section title={showInactive ? `Desativados (${users.length})` : "Equipe"} action={showInactive ? <Link href="/config/usuarios" className="text-sm font-semibold underline underline-offset-4">Voltar à equipe</Link> : undefined}>
        {showInactive && <p className="mb-3 text-sm text-ink-3">Para trazer alguém de volta, cadastre de novo com o mesmo e-mail em “Novo usuário” — a conta é reativada com todo o histórico.</p>}
        <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
          {users.map((u) => (
            <li key={u.id}>
              <Link href={`/config/usuarios/${u.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-bg">
                <span className="min-w-0">
                  <span className="block font-medium">{u.name}</span>
                  <span className="text-sm break-all text-ink-3">
                    {u.email}
                    {u.role === "CONSULTANT" && <> · agenda: {u.aliases.map((a) => a.email).join(", ") || <span className="text-warn">nenhum e-mail vinculado</span>}</>}
                  </span>
                </span>
                <span className="flex gap-1">
                  <Badge>{ROLE_LABEL[u.role]}</Badge>
                  {!u.active && <Badge tone="bad">Desativado</Badge>}
                  {!u.passwordHash && u.active && <Badge tone="warn">Sem senha</Badge>}
                  {u.mustChangePassword && u.active && <Badge tone="accent">Senha provisória</Badge>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      {!showInactive && inactive > 0 && (
        <p className="-mt-4 mb-8 text-right text-[13px] text-ink-3">
          <Link href="/config/usuarios?desativados=1" className="underline underline-offset-4">
            Ver desativados ({inactive})
          </Link>
        </p>
      )}
      <details className="mb-10">
        <summary className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-primary px-6 font-semibold text-on-primary shadow-float">+ Novo usuário</summary>
        <ActionForm action={createUserAction} className="mt-4 max-w-xl rounded-3xl border border-line bg-surface p-5 shadow-card" resetOnSuccess>
          <Field label="Nome" htmlFor="name">
            <Input id="name" name="name" required />
          </Field>
          <Field label="E-mail de login" htmlFor="email" hint="Se for de alguém desativado, a conta antiga é reativada com o histórico.">
            <Input id="email" name="email" type="email" required />
          </Field>
          <Field label="Papel" htmlFor="role">
            <Select id="role" name="role" defaultValue="CONSULTANT">
              <option value="CONSULTANT">Consultora</option>
              <option value="PRE_SERVICE">Pré-atendimento</option>
              {isAdmin(actor) && <option value="MANAGER">Gestora</option>}
              {isAdmin(actor) && <option value="ADMIN">Administrador(a)</option>}
            </Select>
          </Field>
          <Field label="E-mails convidados na agenda (consultoras)" htmlFor="aliases" hint="Separe por vírgula. Use exatamente o e-mail que aparece como convidado nos eventos.">
            <Input id="aliases" name="aliases" />
          </Field>
          <Field label="Senha provisória (opcional)" htmlFor="tempPassword" hint="Com senha provisória, a pessoa entra com ela e é obrigada a criar a própria no primeiro acesso. Sem ela, o app gera um link de uso único.">
            <Input id="tempPassword" name="tempPassword" type="text" autoComplete="off" minLength={10} />
          </Field>
          <SubmitButton>Criar usuário</SubmitButton>
        </ActionForm>
      </details>
    </>
  );
}
