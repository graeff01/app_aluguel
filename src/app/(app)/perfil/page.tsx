import { requireManager } from "@/lib/require";
import { ROLE_LABEL } from "@/lib/labels";
import { logoutAction } from "@/app/actions/auth";
import { PageHeader, Panel, Section, KeyValue } from "@/components/ui";
import { PasswordForm } from "@/components/password-form";
import { InstallHelp } from "./install-help";

export const metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const actor = await requireManager();
  return (
    <>
      <PageHeader title="Perfil" />
      <Panel className="mb-6">
        <KeyValue items={[["Nome", actor.name], ["E-mail", actor.email], ["Papel", ROLE_LABEL[actor.role]]]} />
      </Panel>
      <Section title="Instalar no celular">
        <InstallHelp />
      </Section>
      <Section title="Alterar senha">
        <PasswordForm />
      </Section>
      <form action={logoutAction}>
        <button className="min-h-12 w-full rounded-xl border border-line bg-surface px-5 font-semibold text-bad sm:w-auto">Sair</button>
      </form>
    </>
  );
}
