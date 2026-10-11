import { redirect } from "next/navigation";
import { getActor } from "@/lib/session";
import { LoginForm } from "./form";
import { ClearClientState } from "@/components/clear-client-state";
import { Alert } from "@/components/ui";
import { googleConfigured } from "@/server/sync/google";

const GOOGLE_ERRORS: Record<string, string> = {
  sem_cadastro: "Esta conta Google não está cadastrada no app. Peça à gestão para cadastrar o seu e-mail (ou vinculá-lo em “E-mails da agenda”).",
  inativo: "Seu acesso está desativado. Fale com a gestão.",
  nao_verificado: "O e-mail desta conta Google não está verificado.",
  conta_diferente: "Outra conta Google já está vinculada ao seu usuário. Entre com a conta de sempre ou fale com a administração.",
  google_cancelado: "Entrada com Google cancelada.",
  google_expirou: "A tentativa expirou. Tente de novo.",
  google_falhou: "Não foi possível entrar com Google agora. Tente de novo ou use e-mail e senha.",
  google_indisponivel: "Entrar com Google não está disponível no momento.",
  muitas_tentativas: "Muitas tentativas. Aguarde alguns minutos.",
};

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getActor()) redirect("/");
  const sp = await searchParams;
  return (
    <>
      {sp.saiu && <ClearClientState />}
      {sp.saiu && <Alert tone="good" title="Você saiu do aplicativo." />}
      {sp.senha && <Alert tone="good" title="Senha definida. Entre com a nova senha." />}
      {sp.erro && GOOGLE_ERRORS[sp.erro] && <Alert tone="bad" title={GOOGLE_ERRORS[sp.erro]} />}
      <h1 className="text-[32px] leading-tight font-bold tracking-[-0.035em]">Boas-vindas</h1>
      <p className="mt-2 mb-8 text-[15px] text-ink-2">{googleConfigured() ? "Entre com sua conta Google ou com e-mail e senha." : "Entre com seu e-mail e senha."}</p>
      {googleConfigured() && (
        <>
          <a
            href="/api/auth/google"
            className="press flex min-h-[52px] w-full items-center justify-center gap-3 rounded-full border border-line-strong bg-surface text-[15px] font-semibold text-ink shadow-card transition hover:border-ink-3"
          >
            <svg aria-hidden viewBox="0 0 48 48" className="size-5">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Entrar com Google
          </a>
          <div className="my-6 flex items-center gap-3 text-[13px] text-ink-3">
            <span className="h-px flex-1 bg-line" /> ou com e-mail e senha <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
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
