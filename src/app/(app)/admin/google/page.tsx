import { requireAdmin } from "@/lib/require";
import { db } from "@/lib/db";
import { fmt } from "@/lib/time";
import { env } from "@/lib/env";
import { errorCode } from "@/lib/log";
import { authorizedClient, googleConfigured, realCalendarApi } from "@/server/sync/google";
import { DETAIL_ROLES, type GCalendar } from "@/server/sync/types";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Badge, KeyValue, PageHeader, Panel, Section } from "@/components/ui";
import { disconnectGoogleAction, selectCalendarAction } from "@/app/actions/admin";
import { GoogleSetupGuide } from "./setup-guide";

export const metadata = { title: "Agenda Google" };

const ERRORS: Record<string, string> = {
  nao_configurado: "Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor.",
  negado: "A autorização foi recusada na tela do Google.",
  estado: "Falha de segurança na volta do Google (estado inválido). Tente conectar de novo.",
  escopos: "Permissões insuficientes: marque as opções de ver a lista de agendas e ver eventos na tela do Google.",
  sem_refresh: "O Google não enviou autorização de acesso contínuo. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.",
  identidade: "Não foi possível identificar a conta Google.",
  troca: "Falha ao concluir a autorização. Confira o callback configurado no Google Cloud.",
  google: "O Google retornou um erro.",
};
const ROLE: Record<string, string> = { owner: "Proprietária", writer: "Pode editar", reader: "Vê todos os detalhes", freeBusyReader: "Só ocupado/livre" };

export default async function GooglePage({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const conn = await db.googleConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } });
  const state = conn?.calendarId ? await db.syncState.findUnique({ where: { calendarId: conn.calendarId } }) : null;
  let calendars: GCalendar[] = [];
  let listError = "";
  if (conn?.status === "CONNECTED") {
    try {
      calendars = await realCalendarApi(await authorizedClient(conn.id)).listCalendars();
    } catch (e) {
      listError = errorCode(e);
    }
  }
  return (
    <>
      <PageHeader title="Agenda Google" subtitle="Acesso somente leitura. A conexão do Google é separada do login do app." />
      {sp.ok && <Alert tone="good" title="Conta conectada. Agora selecione o calendário central." />}
      {sp.erro && <Alert tone="bad" title="Não foi possível conectar">{ERRORS[sp.erro] ?? "Erro desconhecido."}</Alert>}
      {!(conn?.status === "CONNECTED" && conn.calendarId) && (
        <Section title="Configuração passo a passo">
          <GoogleSetupGuide configured={googleConfigured()} connected={conn?.status === "CONNECTED"} calendarSelected={!!conn?.calendarId} />
        </Section>
      )}
      {conn?.status === "NEEDS_RECONNECT" && <Alert tone="bad" title="Reconexão necessária">{conn.statusDetail ?? "A autorização expirou ou foi revogada."} O app e os registros continuam funcionando; apenas a importação está parada.</Alert>}
      {conn?.statusDetail && conn.status === "CONNECTED" && <Alert tone="warn" title="Atenção">{conn.statusDetail}</Alert>}

      <Section title="Conexão">
        <Panel>
          {conn ? (
            <KeyValue
              items={[
                ["Conta conectada", conn.googleEmail],
                ["Situação", conn.status === "CONNECTED" ? <Badge tone="good">✓ Conectada</Badge> : <Badge tone="bad">✕ Reconectar</Badge>],
                ["Conectada em", fmt.dateTime(conn.connectedAt)],
                ["Calendário", conn.calendarSummary ? `${conn.calendarSummary} (${ROLE[conn.calendarAccessRole ?? ""] ?? conn.calendarAccessRole})` : <Badge tone="warn">não selecionado</Badge>],
                ["Última sincronização bem-sucedida", state?.lastSuccessAt ? fmt.dateTime(state.lastSuccessAt) : "—"],
              ]}
            />
          ) : (
            <p className="text-ink-2">Nenhuma conta conectada.</p>
          )}
          <p className="mt-4 text-sm text-ink-3">
            A conta conectada precisa ter acesso aos <strong>detalhes</strong> do calendário central (dona do calendário ou compartilhado com “Ver todos os detalhes do evento”). Estar logado no navegador com outra conta não altera quem é a dona do calendário.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {googleConfigured() ? (
              <a href="/api/google/connect" className="inline-flex min-h-12 items-center rounded-full bg-primary px-6 font-semibold text-on-primary shadow-float">
                {conn ? "Reconectar / trocar conta" : "Conectar conta Google"}
              </a>
            ) : (
              <span className="inline-flex min-h-12 items-center rounded-full bg-tint px-6 font-semibold text-ink-3">Conectar conta Google (aguardando credenciais)</span>
            )}
            {conn && (
              <ActionForm action={disconnectGoogleAction} confirm="Desconectar a conta Google? A importação para; registros são mantidos.">
                <SubmitButton variant="danger">Desconectar</SubmitButton>
              </ActionForm>
            )}
          </div>
          <p className="mt-3 text-xs text-ink-3">Callback OAuth: {env.googleRedirectUri}</p>
        </Panel>
      </Section>

      {conn?.status === "CONNECTED" && (
        <Section title="Calendário central">
          {listError ? (
            <Alert tone="bad" title="Não foi possível listar calendários">Código: {listError}</Alert>
          ) : (
            <ul className="space-y-2">
              {calendars.map((c) => {
                const ok = DETAIL_ROLES.has(c.accessRole);
                const selected = c.id === conn.calendarId;
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface p-3">
                    <span className="min-w-0">
                      <span className="block font-medium break-all">{c.summary}</span>
                      <span className="text-sm text-ink-3">
                        {ROLE[c.accessRole] ?? c.accessRole}
                        {!ok && " — não permite importar (faltam detalhes dos eventos)"}
                      </span>
                    </span>
                    {selected ? (
                      <Badge tone="good">✓ Selecionado</Badge>
                    ) : ok ? (
                      <ActionForm action={selectCalendarAction}>
                        <input type="hidden" name="calendarId" value={c.id} />
                        <SubmitButton variant="secondary">Usar este</SubmitButton>
                      </ActionForm>
                    ) : (
                      <Badge tone="warn">Sem permissão</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}
