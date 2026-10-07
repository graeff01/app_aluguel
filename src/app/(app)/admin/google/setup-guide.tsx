import { env } from "@/lib/env";
import { GOOGLE_SCOPES } from "@/server/sync/google";
import { Badge } from "@/components/ui";

type Step = { done: boolean; title: string; body: React.ReactNode };

function Copy({ children }: { children: string }) {
  return <code className="mt-1.5 block rounded-xl bg-surface-2 px-3 py-2 text-[13px] break-all text-ink select-all">{children}</code>;
}

/** Checklist de configuração do Google Cloud com os valores exatos deste ambiente. */
export function GoogleSetupGuide({ configured, connected, calendarSelected }: { configured: boolean; connected: boolean; calendarSelected: boolean }) {
  const steps: Step[] = [
    {
      done: configured,
      title: "Criar o projeto e ativar a Google Calendar API",
      body: (
        <>
          console.cloud.google.com → novo projeto (ex.: “Visitas Locação”) → APIs e serviços → Biblioteca → <strong>Google Calendar API</strong> → Ativar.
        </>
      ),
    },
    {
      done: configured,
      title: "Configurar a tela de consentimento (Google Auth Platform)",
      body: (
        <>
          Público: <strong>Interno</strong> se a agenda central for de um Google Workspace da imobiliária; senão <strong>Externo</strong> e, depois de testar, “Publicar app” (em modo Teste o acesso expira a cada 7 dias). Escopos de dados:
          <ul className="mt-1.5 space-y-1">
            {GOOGLE_SCOPES.map((s) => (
              <li key={s}>
                <Copy>{s}</Copy>
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      done: configured,
      title: "Criar o ID do cliente OAuth (tipo “Aplicativo da Web”)",
      body: (
        <>
          Origem JavaScript autorizada:
          <Copy>{env.appUrl}</Copy>
          <span className="mt-2 block">URI de redirecionamento autorizado:</span>
          <Copy>{env.googleRedirectUri}</Copy>
        </>
      ),
    },
    {
      done: configured,
      title: "Enviar o Client ID e o Client Secret para configurar no servidor",
      body: <>Os valores vão nas variáveis GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET dos serviços web e worker (nunca no código).</>,
    },
    { done: connected, title: "Conectar a conta da agenda central", body: <>Botão “Conectar conta Google” abaixo, entrando com a conta que é dona da agenda central (ou que a vê com todos os detalhes).</> },
    { done: calendarSelected, title: "Selecionar o calendário central", body: <>Escolha o calendário na lista. A primeira sincronização começa automaticamente.</> },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={s.title} className={`rounded-2xl border p-4 ${i === next ? "border-accent/40 bg-surface shadow-card" : "border-line bg-surface"}`}>
          <div className="flex items-start gap-3">
            <span className={`num grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold ${s.done ? "bg-good-soft text-good" : i === next ? "bg-accent text-white" : "bg-tint text-ink-3"}`}>
              {s.done ? "✓" : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {s.title} {i === next && <Badge tone="accent">Próximo passo</Badge>}
              </p>
              {!s.done && <div className="mt-1 text-sm leading-relaxed text-ink-2">{s.body}</div>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
