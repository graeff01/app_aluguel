import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { listPending } from "@/server/queries";
import { dataIssues } from "@/server/visits";
import { Empty, PageHeader, Section, Badge } from "@/components/ui";
import { VisitCard } from "@/components/visit-card";
import Link from "next/link";
import { fmt } from "@/lib/time";
import { pushConfig } from "@/lib/push";
import { PushPrompt } from "@/components/push-toggle";

export const metadata = { title: "Pendências" };

const ISSUE: Record<string, string> = { MISSING_NAME: "sem nome", MISSING_CODE: "sem código", MISSING_PHONE: "sem telefone", INVALID_PHONE: "telefone inválido" };

export default async function PendingPage() {
  const actor = await requireActor();
  const now = new Date();
  const { awaiting, dataIssues: issues } = await listPending(actor, now);
  const global = hasGlobalView(actor);
  const old = awaiting.filter((v) => now.getTime() - v.scheduledEnd.getTime() > 24 * 3600_000).length;
  return (
    <>
      <PageHeader title="Pendências" subtitle="O horário encerrado não confirma que a visita aconteceu — registre o que houve." />
      <PushPrompt publicKey={pushConfig()?.publicKey ?? null} />
      <Section title={`Aguardando resultado (${awaiting.length})`} action={old ? <Badge tone="warn">{old} há mais de 24 h</Badge> : undefined}>
        {awaiting.length === 0 ? (
          <Empty title="Tudo registrado">Nenhuma visita encerrada sem resultado.</Empty>
        ) : (
          <ul className="space-y-3">
            {awaiting.map((v) => (
              <VisitCard key={v.id} v={v} now={now} showConsultant={global} showDate />
            ))}
          </ul>
        )}
      </Section>
      <Section title={`Dados a completar (${issues.length})`}>
        {issues.length === 0 ? (
          <Empty title="Nenhum dado pendente" />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
            {issues.map((v) => (
              <li key={v.id}>
                <Link href={`/visitas/${v.id}/corrigir`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-bg">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{v.clientName ?? "Cliente sem nome"}</span>
                    <span className="text-sm text-ink-3">
                      {fmt.shortDate(v.scheduledStart)} {fmt.time(v.scheduledStart)} · imóvel {v.propertyCode ?? "—"}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {dataIssues(v).map((i) => (
                      <Badge key={i} tone="warn">
                        {ISSUE[i]}
                      </Badge>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
