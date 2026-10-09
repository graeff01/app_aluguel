import { redirect } from "next/navigation";
import { getActor } from "@/lib/session";
import { LoginForm } from "./form";
import { ClearClientState } from "@/components/clear-client-state";
import { Alert } from "@/components/ui";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getActor()) redirect("/");
  const sp = await searchParams;
  return (
    <>
      {sp.saiu && <ClearClientState />}
      {sp.saiu && <Alert tone="good" title="Você saiu do aplicativo." />}
      {sp.senha && <Alert tone="good" title="Senha definida. Entre com a nova senha." />}
      <h1 className="text-[32px] leading-tight font-bold tracking-[-0.035em]">Boas-vindas</h1>
      <p className="mt-2 mb-8 text-[15px] text-ink-2">Entre com seu e-mail e senha.</p>
      <LoginForm />
      <p className="mt-10 border-t border-line pt-6 text-[13px] leading-relaxed text-ink-3">
        Esqueceu a senha? Peça à gestora ou ao administrador um link de redefinição. Não há cadastro público.{" "}
        <a href="/privacidade" className="underline underline-offset-4">
          Aviso de privacidade
        </a>
        .
      </p>
    </>
  );
}
