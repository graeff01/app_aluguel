import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { PasswordForm } from "@/components/password-form";

export const metadata = { title: "Alterar senha" };

export default async function ChangePasswordPage() {
  const actor = await requireActor();
  return (
    <div className="mx-auto max-w-md">
      <Link href={hasGlobalView(actor) ? "/perfil" : "/minhas"} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Voltar
      </Link>
      <h1 className="mb-1 text-[28px] leading-tight font-bold tracking-[-0.03em]">Alterar senha</h1>
      <p className="mb-6 text-ink-2">Ao trocar, as outras sessões abertas em outros aparelhos são encerradas.</p>
      <PasswordForm />
    </div>
  );
}
