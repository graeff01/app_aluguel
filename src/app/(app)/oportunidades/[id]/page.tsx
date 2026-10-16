import Link from "next/link";
import { requireActor, orNotFound } from "@/lib/require";
import { getOpportunity } from "@/server/queries";
import { canUpdateOpportunity, hasGlobalView } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { dayKey, dateOnlyKey, fmt } from "@/lib/time";
import { OPP_STATUS_LABEL } from "@/lib/labels";
import { Badge, KeyValue, PageHeader, Panel, Section } from "@/components/ui";
import { VisitCard } from "@/components/visit-card";
import { OppForm, TransferForm } from "./forms";

export const metadata = { title: "Oportunidade" };

export default async function OppPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ para?: string; salvo?: string }> }) {
  const { para, salvo } = await searchParams;
  const actor = await requireActor();
  const { id } = await params;
  const opp = await orNotFound(getOpportunity(actor, id));
  const settings = await getSettings();
  const canUpdate = canUpdateOpportunity(actor, opp, settings);
  const global = hasGlobalView(actor);
  const list = (kind: "OPPORTUNITY_LOST" | "LEASE_AGENT" | "LEASE_HIGHLIGHT") => db.reason.findMany({ where: { kind, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } });
  const lease = await db.leasePost.findUnique({ where: { opportunityId: opp.id }, include: { agent: { select: { label: true } } } });
  const [lostReasons, users, agents, highlights] = await Promise.all([
    list("OPPORTUNITY_LOST"),
    global ? db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true } }) : Promise.resolve([]),
    list("LEASE_AGENT"),
    list("LEASE_HIGHLIGHT"),
  ]);
  // diferenciais que o app já sabe: alugado na 1ª visita / em até 7 dias da 1ª visita
  const doneVisits = opp.visits.filter((v) => v.status === "DONE").length;
  const days = Math.floor((Date.now() - opp.firstDoneVisitAt.getTime()) / 86400_000);
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const suggested = highlights
    .filter((h) => (doneVisits === 1 && /1(a|ª)? visita|primeira visita/.test(norm(h.label)) && !/dias/.test(norm(h.label))) || (days <= 7 && /7 dias/.test(norm(h.label))))
    .map((h) => h.id);
  return (
    <>
      <Link href="/oportunidades" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Andamento
      </Link>
      <PageHeader
        title={`${opp.client.name} · imóvel ${opp.property.code}`}
        subtitle={<Badge tone={opp.status === "CLOSED_WON" ? "good" : opp.status === "LOST" ? "bad" : "info"}>{OPP_STATUS_LABEL[opp.status]}</Badge>}
      />
      {salvo && (
        <p role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">
          {salvo === "CLOSED_WON" ? "✓ Locação fechada. O marketing foi avisado para postar." : salvo === "LOST" ? "✓ Perda registrada." : "✓ Andamento atualizado."}
        </p>
      )}
      <Panel className="mb-6">
        <KeyValue
          items={[
            ["Ciclo", opp.cycle],
            ["Responsável", opp.responsible?.name ?? "—"],
            ["1ª visita realizada", fmt.date(opp.firstDoneVisitAt)],
            ...(opp.closedAt ? [["Fechamento", `${fmt.dayKey(dateOnlyKey(opp.closedAt))} · ${opp.closedResponsible?.name ?? "—"}`] as [string, React.ReactNode]] : []),
            ...(lease
              ? [["Marketing", `${lease.postedAt ? `postado em ${fmt.date(lease.postedAt)}` : "aguardando postagem"} · agenciador ${lease.agent.label}${lease.highlights.length ? ` · ${lease.highlights.join(", ")}` : ""} — ${lease.highlightNote}`] as [string, React.ReactNode]]
              : []),
            ...(opp.status === "LOST"
              ? [["Perda", `${opp.lostOrigin === "VISIT_NEGATIVE" ? "Visita negativa" : "Perda posterior"}${opp.lostReason ? ` · ${opp.lostReason.label}` : ""}${opp.lostNote ? ` — ${opp.lostNote}` : ""}`] as [string, React.ReactNode]]
              : []),
          ]}
        />
      </Panel>
      {canUpdate && (
        <Section title="Atualizar andamento">
          <OppForm initialTo={para} opp={{ id: opp.id, version: opp.version, status: opp.status, responsibleId: opp.responsibleId }} lostReasons={lostReasons} users={users} today={dayKey(new Date())} agents={agents} highlights={highlights} suggested={suggested} canManageLists={global} />
        </Section>
      )}
      {global && (
        <Section title="Transferir responsável">
          <TransferForm oppId={opp.id} users={users} current={opp.responsibleId} />
        </Section>
      )}
      <Section title="Visitas">
        <ul className="space-y-3">
          {opp.visits.map((v) => (
            <VisitCard key={v.id} v={v} showDate showConsultant={global} />
          ))}
        </ul>
      </Section>
      <Section title="Histórico">
        <ol className="space-y-2">
          {opp.events.map((e) => (
            <li key={e.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <p className="text-sm text-ink-3">
                {fmt.dateTime(e.createdAt)} · {e.author?.name ?? "Sistema"}
              </p>
              <p className="font-medium">{e.fromStatus && e.fromStatus !== e.toStatus ? `${OPP_STATUS_LABEL[e.fromStatus]} → ${OPP_STATUS_LABEL[e.toStatus]}` : OPP_STATUS_LABEL[e.toStatus]}</p>
              {e.note && <p className="whitespace-pre-wrap text-ink-2">{e.note}</p>}
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
