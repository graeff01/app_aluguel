import { requireAdmin } from "@/lib/require";
import { db } from "@/lib/db";
import { fmt } from "@/lib/time";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Badge, Field, KeyValue, PageHeader, Panel, Section, Select } from "@/components/ui";
import { SyncButton } from "@/components/sync-button";
import { createDemoDataAction, fullSyncAction, removeDemoDataAction } from "@/app/actions/admin";
import { countDemoVisits } from "@/server/demo";

export const metadata = { title: "Diagnóstico" };

const RUN_TONE = { SUCCESS: "good", FAILED: "bad", RUNNING: "info", QUEUED: "neutral", SKIPPED: "warn" } as const;
const RUN_LABEL = { SUCCESS: "Sucesso", FAILED: "Falhou", RUNNING: "Executando", QUEUED: "Na fila", SKIPPED: "Ignorada" } as const;

export default async function DiagnosticsPage() {
  await requireAdmin();
  const conn = await db.googleConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } });
  const errors = await db.errorEvent.findMany({ orderBy: { lastSeenAt: "desc" }, take: 30 });
  const [state, runs, beats, counts] = await Promise.all([
    conn?.calendarId ? db.syncState.findUnique({ where: { calendarId: conn.calendarId } }) : null,
    db.syncRun.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { requestedBy: { select: { name: true } } } }),
    db.workerHeartbeat.findMany({ orderBy: { beatAt: "desc" }, take: 5 }),
    Promise.all([db.sourceEvent.count(), db.sourceEvent.count({ where: { classification: "AMBIGUOUS", reviewDecision: null } }), db.visit.count({ where: { origin: "GOOGLE" } }), db.visit.count({ where: { origin: "MANUAL" } })]),
  ]);
  const demoVisits = await countDemoVisits();
  const consultants = await db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const workerAlive = beats[0] && Date.now() - beats[0].beatAt.getTime() < 2 * 60_000;
  return (
    <>
      <PageHeader title="Diagnóstico da sincronização" action={<SyncButton />} />
      {!workerAlive && <Alert tone="bad" title="Worker sem sinal">O processo de sincronização não reportou atividade nos últimos 2 minutos. Verifique o serviço “worker” no Railway.</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-3 font-semibold">Estado</h2>
          <KeyValue
            items={[
              ["Worker", beats[0] ? `${workerAlive ? "ativo" : "parado"} · último sinal ${fmt.dateTime(beats[0].beatAt)}` : "nunca executou"],
              ["Última sucesso", state?.lastSuccessAt ? fmt.dateTime(state.lastSuccessAt) : "—"],
              ["Última tentativa", state?.lastAttemptAt ? fmt.dateTime(state.lastAttemptAt) : "—"],
              ["Falhas seguidas", state?.consecutiveFailures ?? 0],
              ["Próxima tentativa após falha", state?.nextAttemptAt ? fmt.dateTime(state.nextAttemptAt) : "—"],
              ["Último erro", state?.lastErrorCode ?? "—"],
              ["Incremental (token)", state?.syncToken ? "sim" : "não — próxima é completa"],
              ["Janela importada", state?.windowStart && state.windowEnd ? `${fmt.date(state.windowStart)} a ${fmt.date(state.windowEnd)}` : "—"],
              ["Última completa / reconciliação", state?.lastFullSyncAt ? fmt.dateTime(state.lastFullSyncAt) : "—"],
            ]}
          />
        </Panel>
        <Panel>
          <h2 className="mb-3 font-semibold">Volumes</h2>
          <KeyValue items={[["Eventos espelhados", counts[0]], ["Ambíguos sem decisão", counts[1]], ["Visitas da agenda", counts[2]], ["Visitas manuais", counts[3]]]} />
          <p className="mt-3 text-xs text-ink-3">Eventos claramente irrelevantes não são guardados.</p>
          <ActionForm action={fullSyncAction} className="mt-4" confirm="Forçar sincronização completa da janela? Resultados registrados não são apagados.">
            <SubmitButton variant="secondary">Forçar sincronização completa</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
      <Section title={`Erros recentes (${errors.length})`} id="erros" hint="Agrupados por tipo. Mensagens sem dados pessoais. Admin recebe aviso no celular quando surge um tipo novo.">
        {errors.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line-strong bg-surface-2 p-5 text-sm text-ink-3">Nenhum erro registrado.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface text-sm shadow-card">
            {errors.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {e.source === "client" ? "Aparelho" : e.source === "worker" ? "Worker" : "Servidor"}
                    {e.path ? <span className="font-normal text-ink-3"> · {e.path}</span> : null}
                  </span>
                  <Badge tone={Date.now() - e.lastSeenAt.getTime() < 3600_000 ? "bad" : "neutral"}>
                    {e.count}× · último {fmt.dateTime(e.lastSeenAt)}
                  </Badge>
                </div>
                <p className="mt-1 break-words text-ink-2">{e.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Execuções recentes">
        <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card text-sm">
          {runs.map((r) => {
            const s = r.stats as Record<string, number | string | boolean> | null;
            return (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {fmt.dateTime(r.createdAt)} · {r.trigger === "MANUAL" ? `manual${r.requestedBy ? ` (${r.requestedBy.name})` : ""}` : "agendada"}
                    {r.mode ? ` · ${r.mode === "full" ? "completa" : "incremental"}` : ""}
                  </span>
                  <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
                </div>
                {s && (
                  <p className="text-ink-3">
                    recebidos {s.received} · visitas {s.visits} · novas {s.created} · atualizadas {s.updated} · canceladas {s.canceled} · ambíguos {s.ambiguous} · ignorados {s.ignored} · conflitos {s.conflicts}
                    {s.windowExtended ? " · janela ampliada" : ""}
                  </p>
                )}
                {r.errorMessage && <p className="text-bad">{r.errorCode}: {r.errorMessage}</p>}
              </li>
            );
          })}
          {runs.length === 0 && <li className="px-4 py-3 text-ink-3">Nenhuma execução ainda.</li>}
        </ul>
      </Section>
      <Section title="Dados de demonstração" hint="Visitas fictícias com imóveis reais do site (fotos e bairros de verdade) para mostrar as telas.">
        <Panel>
          <p className="text-ink-2">
            Cria 10 visitas para a consultora escolhida — ontem, hoje (registradas, aguardando, em andamento e próximas) e amanhã. Nomes de clientes fictícios, sem telefone.{" "}
            <strong className="text-ink">Não geram notificações</strong> e ficam fora do termômetro, do relatório do proprietário e do relatório mensal. Aparecem no painel e no Ao vivo até serem removidas.
          </p>
          {consultants.length > 0 && (
            <ActionForm action={createDemoDataAction} className="mt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="sm:w-72">
                  <Field label="Consultora" htmlFor="demo-consultant">
                    <Select id="demo-consultant" name="consultantId" defaultValue={consultants[0].id}>
                      {consultants.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <SubmitButton variant="secondary" className="mb-4 sm:mb-5">
                  Criar visitas de demonstração
                </SubmitButton>
              </div>
            </ActionForm>
          )}
          {demoVisits > 0 && (
            <div className="mt-2 border-t border-line pt-4">
              <p className="text-ink-2">
                Há <strong className="text-ink">{demoVisits}</strong> visita{demoVisits === 1 ? "" : "s"} de demonstração no sistema. Remova antes de começar a usar com dados reais.
              </p>
              <ActionForm action={removeDemoDataAction} confirm="Remover todas as visitas de demonstração? Isso não afeta visitas reais." className="mt-3">
                <SubmitButton variant="secondary">Remover dados de demonstração</SubmitButton>
              </ActionForm>
            </div>
          )}
        </Panel>
      </Section>
    </>
  );
}
