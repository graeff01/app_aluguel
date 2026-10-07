import Link from "next/link";
import { requireManager } from "@/lib/require";
import { reviewQueues } from "@/server/queries";
import { db } from "@/lib/db";
import { fmt } from "@/lib/time";
import { ASSIGNMENT_NOTE_LABEL } from "@/lib/parser";
import { CONFLICT_LABEL } from "@/lib/labels";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { AmbiguousInline, AssignInline, ClientLinkInline, ConflictInline } from "./forms";

export const metadata = { title: "Revisão" };

function VisitLine({ v }: { v: { id: string; scheduledStart: Date; clientName: string | null; propertyCode: string | null; consultant: { name: string } | null } }) {
  return (
    <Link href={`/visitas/${v.id}`} className="font-medium hover:underline">
      {fmt.shortDate(v.scheduledStart)} {fmt.time(v.scheduledStart)} · {v.clientName ?? "Cliente sem nome"} · imóvel {v.propertyCode ?? "—"}
      {v.consultant ? ` · ${v.consultant.name}` : ""}
    </Link>
  );
}

export default async function ReviewPage() {
  await requireManager();
  const q = await reviewQueues();
  const consultants = await db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const candName = new Map(q.candidates.map((c) => [c.id, c.name]));
  const card = "rounded-3xl border border-line bg-surface p-5 shadow-card";
  const total = q.assignment.length + q.conflicts.length + q.ambiguous.length + q.suggested.length + q.missing.length;
  return (
    <>
      <PageHeader title="Revisão" subtitle={total ? `${total} itens aguardando decisão` : "Nada para revisar"} />

      <Section title={`Atribuição de consultora (${q.assignment.length})`} id="atribuicao">
        {q.assignment.length === 0 ? (
          <Empty title="Todas as visitas têm consultora" />
        ) : (
          <ul className="space-y-3">
            {q.assignment.map((v) => (
              <li key={v.id} className={card}>
                <VisitLine v={v} />
                <p className="text-sm text-warn">{ASSIGNMENT_NOTE_LABEL[v.assignmentNote ?? ""] ?? "Revisar atribuição"}</p>
                <AssignInline visitId={v.id} consultants={consultants} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Conflitos com a agenda (${q.conflicts.length})`} id="conflitos">
        {q.conflicts.length === 0 ? (
          <Empty title="Sem conflitos" />
        ) : (
          <ul className="space-y-3">
            {q.conflicts.map((v) => {
              const detail = (v.conflictDetail ?? {}) as { google?: Record<string, string | null>; current?: Record<string, string | null>; candidateVisitId?: string };
              return (
                <li key={v.id} className={card}>
                  <VisitLine v={v} />
                  <p className="text-sm text-warn">{CONFLICT_LABEL[v.syncConflict]}</p>
                  {detail.google && (
                    <ul className="mt-2 text-sm text-ink-2">
                      {Object.entries(detail.google).map(([k, g]) => (
                        <li key={k}>
                          {k}: app “{fmtVal(detail.current?.[k])}” → agenda “{fmtVal(g)}”
                        </li>
                      ))}
                    </ul>
                  )}
                  {detail.candidateVisitId && (
                    <p className="mt-1 text-sm">
                      Visita anterior:{" "}
                      <Link href={`/visitas/${detail.candidateVisitId}`} className="text-primary underline">
                        abrir
                      </Link>
                    </p>
                  )}
                  <ConflictInline visitId={v.id} conflict={v.syncConflict} canMerge={v.status === "SCHEDULED"} />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={`Eventos possivelmente de visita (${q.ambiguous.length})`} id="ambiguos">
        {q.ambiguous.length === 0 ? (
          <Empty title="Nenhum evento ambíguo" />
        ) : (
          <ul className="space-y-3">
            {q.ambiguous.map((e) => (
              <li key={e.id} className={card}>
                <p className="text-sm text-ink-3">{e.startAt ? `${fmt.shortDate(e.startAt)} ${fmt.time(e.startAt)}` : "sem horário"}</p>
                <p className="font-medium break-words">{e.title ?? "(sem título)"}</p>
                <p className="text-sm text-ink-3">Não segue o padrão configurado. Confirme para importar como visita.</p>
                <AmbiguousInline id={e.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Vínculo de clientes a confirmar (${q.suggested.length})`} id="clientes" action={<Link href="/clientes?identidade=PENDING" className="text-sm text-primary">{q.pendingClients} cadastros com identificação pendente →</Link>}>
        {q.suggested.length === 0 ? (
          <Empty title="Nenhum vínculo a confirmar" />
        ) : (
          <ul className="space-y-3">
            {q.suggested.map((v) => (
              <li key={v.id} className={card}>
                <VisitLine v={v} />
                <p className="text-sm text-warn">Telefone já usado por outro cadastro com nome diferente. Não foi unido automaticamente.</p>
                <ClientLinkInline visitId={v.id} candidates={v.clientCandidates.map((id) => ({ id, name: candName.get(id) ?? "cadastro" }))} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Dados ausentes (${q.missing.length})`} id="dados">
        {q.missing.length === 0 ? (
          <Empty title="Sem dados ausentes" />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
            {q.missing.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <VisitLine v={v} />
                <span className="flex gap-1">
                  {!v.clientName && <Badge tone="warn">sem nome</Badge>}
                  {!v.propertyCode && <Badge tone="warn">sem código</Badge>}
                  <Link className="ml-2 text-primary" href={`/visitas/${v.id}/corrigir`}>
                    Corrigir
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function fmtVal(v: string | null | undefined) {
  if (!v) return "—";
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return fmt.dateTime(new Date(v));
  return v;
}
