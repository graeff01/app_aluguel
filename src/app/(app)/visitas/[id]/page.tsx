import Link from "next/link";
import { requireActor, orNotFound } from "@/lib/require";
import { getVisitDetail } from "@/server/queries";
import { canCorrectVisitData, hasGlobalView } from "@/lib/authz";
import { fmt } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { ASSIGNMENT_NOTE_LABEL } from "@/lib/parser";
import { CONFLICT_LABEL, EVALUATION_LABEL, MATCH_LABEL, OPP_STATUS_LABEL, STATUS_LABEL } from "@/lib/labels";
import { Alert, Badge, KeyValue, LinkButton, Panel, Section } from "@/components/ui";
import { VisitStatusBadge } from "@/components/visit-badges";
import { VisitAdminTools } from "./admin-tools";
import { db } from "@/lib/db";

export const metadata = { title: "Visita" };

export default async function VisitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  const now = new Date();
  const { visit, relatedVisits, awaiting, charged, settings } = await orNotFound(getVisitDetail(actor, id, now));
  const global = hasGlobalView(actor);
  const canCorrect = canCorrectVisitData(actor, visit, settings);
  const consultants = global ? await db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const concluded = visit.status !== "SCHEDULED";
  const started = visit.scheduledStart.getTime() <= now.getTime() + 15 * 60_000;

  return (
    <>
      <Link href="/hoje" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Voltar
      </Link>
      {sp.salvo && <Alert tone="good" title="Resultado salvo no servidor." />}
      {sp.corrigido && <Alert tone="good" title="Dados corrigidos." />}
      {sp.criada && <Alert tone="good" title="Visita cadastrada." />}
      {visit.syncConflict !== "NONE" && (
        <Alert tone="warn" title="Conflito com a agenda Google">
          {CONFLICT_LABEL[visit.syncConflict]}. O resultado registrado foi preservado{global ? " — resolva na Revisão." : "; a gestão vai revisar."}
        </Alert>
      )}
      {!charged && visit.status === "SCHEDULED" && (
        <Alert tone="neutral" title="Visita anterior à data de início da cobrança de resultados">Registrar é opcional.</Alert>
      )}

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-ink-3">
            <span>{fmt.longDate(visit.scheduledStart)}</span> · {fmt.time(visit.scheduledStart)}–{fmt.time(visit.scheduledEnd)}
          </p>
          <h1 className="text-2xl font-bold">{visit.clientName ?? <span className="text-warn">Cliente sem nome</span>}</h1>
        </div>
        <VisitStatusBadge v={visit} now={now} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {visit.consultantId && !visit.excluded && (visit.status === "SCHEDULED" ? started : true) && (
          <LinkButton href={`/visitas/${visit.id}/registrar`} variant={concluded ? "secondary" : "primary"} className="flex-1 sm:flex-none">
            {concluded ? "Alterar resultado" : "Registrar resultado"}
          </LinkButton>
        )}
        {canCorrect && (
          <LinkButton href={`/visitas/${visit.id}/corrigir`} variant="secondary" className="flex-1 sm:flex-none">
            Corrigir dados
          </LinkButton>
        )}
      </div>
      {awaiting && <p className="-mt-3 mb-5 text-sm text-warn">O horário terminou, mas isso não confirma a visita. Registre o que aconteceu.</p>}

      <div className="mb-10 grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-3 font-semibold">Dados da visita</h2>
          <KeyValue
            items={[
              ["Cliente", visit.clientName ?? <Badge tone="warn">ausente</Badge>],
              ["Telefone", visit.phoneRaw ? <>{formatPhone(visit.phoneNormalized, visit.phoneRaw)} {!visit.phoneNormalized && <Badge tone="warn">a validar</Badge>}</> : <Badge tone="warn">ausente</Badge>],
              ["Imóvel", visit.propertyCode ?? <Badge tone="warn">ausente</Badge>],
              ["Consultora", visit.consultant?.name ?? <Badge tone="warn">a definir</Badge>],
              ["Origem", visit.origin === "GOOGLE" ? "Agenda Google" : "Cadastro manual"],
              ...(visit.externalRef ? [["Ref. externa", <span key="r">{visit.externalRef} <span className="text-xs text-ink-3">(significado não confirmado)</span></span>] as [string, React.ReactNode]] : []),
              ...(global ? [["Identificação", MATCH_LABEL[visit.clientMatch]] as [string, React.ReactNode]] : []),
              ...(global && visit.assignmentNote ? [["Atribuição", ASSIGNMENT_NOTE_LABEL[visit.assignmentNote] ?? visit.assignmentNote] as [string, React.ReactNode]] : []),
            ]}
          />
          {visit.manualFields.length > 0 && <p className="mt-3 text-xs text-ink-3">Campos corrigidos no app não são sobrescritos pela agenda.</p>}
        </Panel>

        <Panel>
          <h2 className="mb-3 font-semibold">Resultado</h2>
          {concluded ? (
            <KeyValue
              items={[
                ["Situação", STATUS_LABEL[visit.status] + (visit.autoCanceled ? " (na agenda Google)" : "")],
                ...(visit.evaluation ? [["Avaliação", EVALUATION_LABEL[visit.evaluation]] as [string, React.ReactNode]] : []),
                ...(visit.negativeReason ? [["Motivo", visit.negativeReason.label] as [string, React.ReactNode]] : []),
                ["Observação", <span key="n" className="whitespace-pre-wrap">{visit.note ?? "—"}</span>],
                ["Registrado", visit.concludedAt ? `${fmt.dateTime(visit.concludedAt)}${visit.concludedBy ? ` por ${visit.concludedBy.name}` : ""}` : "—"],
              ]}
            />
          ) : (
            <p className="text-ink-2">Ainda sem resultado.</p>
          )}
        </Panel>
      </div>

      {visit.opportunity && (
        <Section title="Andamento">
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                <Badge tone={visit.opportunity.status === "CLOSED_WON" ? "good" : visit.opportunity.status === "LOST" ? "bad" : "info"}>{OPP_STATUS_LABEL[visit.opportunity.status]}</Badge>{" "}
                <span className="text-ink-2">ciclo {visit.opportunity.cycle} · responsável {visit.opportunity.responsible?.name ?? "—"}</span>
              </p>
              <LinkButton href={`/oportunidades/${visit.opportunity.id}`} variant="ghost">
                Ver andamento →
              </LinkButton>
            </div>
          </Panel>
        </Section>
      )}

      {visit.history.length > 0 && (
        <Section title="Histórico de registros">
          <ol className="space-y-2">
            {visit.history.map((h) => (
              <li key={h.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                <p className="text-sm text-ink-3">
                  {fmt.dateTime(h.createdAt)} · {h.author?.name ?? "Sistema (agenda)"}
                </p>
                <p className="font-medium">
                  {STATUS_LABEL[h.status]}
                  {h.evaluation ? ` · ${EVALUATION_LABEL[h.evaluation]}` : ""}
                </p>
                {h.note && <p className="whitespace-pre-wrap text-ink-2">{h.note}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {relatedVisits.length > 0 && (
        <Section title="Outras visitas deste cliente">
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
            {relatedVisits.map((r) => (
              <li key={r.id}>
                <Link href={`/visitas/${r.id}`} className="block px-4 py-3 hover:bg-bg">
                  <span className="flex justify-between gap-2">
                    <span>
                      {fmt.date(r.scheduledStart)} · imóvel {r.propertyCode ?? "—"}
                    </span>
                    <VisitStatusBadge v={r} now={now} />
                  </span>
                  {r.note && <span className="mt-1 line-clamp-2 block text-sm text-ink-3">{r.note}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {visit.sourceEvent?.description && (
        <details className="mb-8 rounded-3xl border border-line bg-surface p-5 shadow-card">
          <summary className="min-h-11 cursor-pointer font-semibold">Descrição do evento na agenda</summary>
          {/* texto puro sanitizado no servidor; React escapa o conteúdo */}
          <p className="mt-2 text-sm whitespace-pre-wrap text-ink-2">{visit.sourceEvent.description}</p>
        </details>
      )}

      {global && <VisitAdminTools visitId={visit.id} consultants={consultants} currentConsultantId={visit.consultantId} excluded={visit.excluded} />}
    </>
  );
}
