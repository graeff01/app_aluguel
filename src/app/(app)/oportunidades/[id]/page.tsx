import Link from "next/link";
import { ClientFileLink } from "@/components/client-file-link";
import { InlineAction } from "@/components/inline-action";
import { startSearchFromOpportunityAction } from "@/app/actions/client-search";
import { requireActor, orNotFound } from "@/lib/require";
import { getOpportunity } from "@/server/queries";
import { canUpdateOpportunity, hasGlobalView } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { dayKey, dateOnlyKey, fmt } from "@/lib/time";
import { DEAL_STAGES, DEAL_TYPE_LABEL, FELL_LABEL, STAGE_LABEL, situationLabel, stageIndex, type Stage } from "@/lib/deal-stages";
import { Badge, KeyValue, PageHeader, Panel, Section, cx } from "@/components/ui";
import { VisitCard } from "@/components/visit-card";
import { TransferForm } from "./forms";
import { DealForm } from "./deal-form";

export const metadata = { title: "Negócio" };

const brl = (c: number | null) => (c ? (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null);
const d = (x: Date | null) => (x ? fmt.dayKey(dateOnlyKey(x)) : null);

export default async function OppPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ para?: string; salvo?: string }> }) {
  const { para, salvo } = await searchParams;
  const actor = await requireActor();
  const { id } = await params;
  const opp = await orNotFound(getOpportunity(actor, id));
  const settings = await getSettings();
  const canUpdate = canUpdateOpportunity(actor, opp, settings);
  const global = hasGlobalView(actor);
  const list = (kind: "OPPORTUNITY_LOST" | "LEASE_AGENT" | "LEASE_HIGHLIGHT" | "GUARANTEE" | "PRE_MISSING") => db.reason.findMany({ where: { kind, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } });
  const [lease, lostReasons, users, agents, highlights, guarantees, missing] = await Promise.all([
    db.leasePost.findUnique({ where: { opportunityId: opp.id }, include: { agent: { select: { label: true } } } }),
    list("OPPORTUNITY_LOST"),
    global ? db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true } }) : Promise.resolve([]),
    list("LEASE_AGENT"),
    list("LEASE_HIGHLIGHT"),
    list("GUARANTEE"),
    list("PRE_MISSING"),
  ]);
  // diferenciais que o app já sabe: alugado na 1ª visita / em até 7 dias da 1ª visita
  const doneVisits = opp.visits.filter((v) => v.status === "DONE").length;
  const days = Math.floor((Date.now() - opp.firstDoneVisitAt.getTime()) / 86400_000);
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const suggested = highlights
    .filter((h) => (doneVisits === 1 && /1(a|ª)? visita|primeira visita/.test(norm(h.label)) && !/dias/.test(norm(h.label))) || (days <= 7 && /7 dias/.test(norm(h.label))))
    .map((h) => h.id);

  const stage = opp.stage as Stage | null;
  const lost = opp.status === "LOST";
  const activeSearch = lost ? await db.clientSearch.findFirst({ where: { clientId: opp.clientId, status: "ACTIVE" }, select: { id: true } }) : null;
  // quando entrou em cada etapa (último registro de entrada)
  const entered = new Map<Stage, { at: Date; by: string | null }>();
  for (const e of [...opp.events].reverse()) if (e.toStage) entered.set(e.toStage as Stage, { at: e.createdAt, by: e.author?.name ?? null });
  const stageData: Record<Stage, (string | null)[]> = {
    NEGOTIATION: [brl(opp.proposedRentCents) && `Valor proposto ${brl(opp.proposedRentCents)}`, opp.intendedGuarantee && `Garantia pretendida: ${opp.intendedGuarantee}`],
    OWNER_PENDING: [d(opp.proposalSentAt) && `Proposta enviada em ${d(opp.proposalSentAt)}`],
    PRE_ANALYSIS: [d(opp.ownerAcceptedAt) && `Aceite em ${d(opp.ownerAcceptedAt)}`, brl(opp.agreedRentCents) && `Valor final ${brl(opp.agreedRentCents)}`],
    KYC_SENT: [d(opp.kycSentAt) && `KYC enviado em ${d(opp.kycSentAt)}`, d(opp.kycDueAt) && `prazo ${d(opp.kycDueAt)}`, opp.docsMissing.length ? `Falta: ${opp.docsMissing.join(", ")}` : null],
    ANALYSIS: [],
    APPROVED: [opp.guarantee && `Garantia: ${opp.guarantee}`, d(opp.analysisDecidedAt) && `Aprovado em ${d(opp.analysisDecidedAt)}`],
    INSPECTION: [opp.inspectionNeeded === null ? null : opp.inspectionNeeded ? "Com vistoria" : "Sem vistoria"],
    CONTRACT: [d(opp.contractReleasedAt) && `Liberado em ${d(opp.contractReleasedAt)}`, d(opp.contractSentAt) && `Enviado em ${d(opp.contractSentAt)}`],
    SIGNED: [d(opp.signedAt) && `Assinado em ${d(opp.signedAt)}`, opp.dealType && DEAL_TYPE_LABEL[opp.dealType], brl(opp.contractValueCents) && `${brl(opp.contractValueCents)} (VGL)`],
    POSSESSION: [d(opp.possessionAt) && `Posse em ${d(opp.possessionAt)}`, opp.keysHolderChecked ? "Chaves retiradas pelo titular" : null],
  };
  const sinceDays = Math.floor((Date.now() - opp.stageChangedAt.getTime()) / 86400_000);

  return (
    <>
      <Link href="/oportunidades" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Andamento
      </Link>
      <PageHeader
        title={`${opp.client.name} · imóvel ${opp.property.code}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={opp.status === "CLOSED_WON" ? "good" : lost ? "bad" : "info"}>{situationLabel({ stage, status: opp.status })}</Badge>
            {!lost && <span className="text-[13px] text-ink-3">há {sinceDays} dia{sinceDays === 1 ? "" : "s"} nesta situação</span>}
          </span>
        }
      />
      <ClientFileLink clientId={opp.clientId} className="-mt-2 mb-5" />
      {salvo && <p role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">{salvo === "SIGNED" ? "✓ Contrato assinado. O marketing foi avisado para postar." : salvo === "FELL" ? "✓ Registrado que o negócio caiu." : `✓ Situação atualizada: ${STAGE_LABEL[salvo as Stage] ?? ""}.`}</p>}

      {/* linha do tempo do fluxo */}
      <ol className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {DEAL_STAGES.map((s, i) => {
          const done = stageIndex(stage) > i || (stage === s && !lost) || (lost && stageIndex(opp.lostStage as Stage | null) > i);
          const current = stage === s && !lost;
          const fellHere = lost && opp.lostStage === s;
          const info = stageData[s].filter(Boolean);
          return (
            <li key={s} className={cx("rounded-2xl border p-3", current ? "border-accent bg-accent-soft/50" : fellHere ? "border-bad/40 bg-bad-soft" : done ? "border-good/25 bg-good-soft/40" : "border-line bg-surface")}>
              <p className="flex items-center gap-2 text-[13px] font-bold">
                <span aria-hidden className={cx("grid size-5 shrink-0 place-items-center rounded-full text-[11px]", current ? "bg-accent text-white" : fellHere ? "bg-bad text-white" : done ? "bg-good text-bg" : "bg-tint text-ink-3")}>{fellHere ? "✕" : done && !current ? "✓" : i + 1}</span>
                {STAGE_LABEL[s]}
              </p>
              {entered.get(s) && <p className="mt-0.5 text-[12px] text-ink-3">{fmt.shortDate(entered.get(s)!.at)}{entered.get(s)!.by ? ` · ${entered.get(s)!.by!.split(" ")[0]}` : ""}</p>}
              {info.length > 0 && <p className="mt-1 text-[12px] leading-snug text-ink-2">{info.join(" · ")}</p>}
              {fellHere && <p className="mt-1 text-[12px] font-semibold text-bad">{FELL_LABEL} aqui{opp.lostReason ? `: ${opp.lostReason.label}` : ""}</p>}
            </li>
          );
        })}
      </ol>

      <Panel className="mb-6">
        <KeyValue
          items={[
            ["Responsável", opp.responsible?.name ?? "—"],
            ["1ª visita realizada", fmt.date(opp.firstDoneVisitAt)],
            ...(lease
              ? [["Marketing", `${lease.postedAt ? `postado em ${fmt.date(lease.postedAt)}` : "aguardando postagem"} · agenciador ${lease.agent.label}${lease.highlights.length ? ` · ${lease.highlights.join(", ")}` : ""} — ${lease.highlightNote}`] as [string, React.ReactNode]]
              : []),
            ...(lost ? [["Caiu", `${opp.lostStage ? `na etapa ${STAGE_LABEL[opp.lostStage as Stage]}` : opp.lostOrigin === "VISIT_NEGATIVE" ? "na visita (negativa)" : "em acompanhamento"}${opp.lostReason ? ` · ${opp.lostReason.label}` : ""}${opp.lostNote ? ` — ${opp.lostNote}` : ""}`] as [string, React.ReactNode]] : []),
          ]}
        />
      </Panel>
      {lost && (canUpdate || global) && (
        <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-accent/30 bg-accent-soft px-5 py-4">
          <span>
            <span className="block text-[15px] font-bold">{activeSearch ? "Cliente em busca de outro imóvel" : "O cliente segue procurando outro imóvel?"}</span>
            <span className="text-[13px] text-ink-2">{activeSearch ? "Acompanhe em Clientes em busca." : "Marque sem reabrir este negócio: ele entra em “Clientes em busca”, com lembrete para oferecer opções."}</span>
          </span>
          {activeSearch ? (
            <Link href={`/em-busca/${activeSearch.id}`} className="press inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-[14px] font-semibold text-white">
              Abrir busca →
            </Link>
          ) : (
            <InlineAction action={startSearchFromOpportunityAction} fields={{ opportunityId: opp.id }} label="Cliente segue em busca" variant="primary" />
          )}
        </section>
      )}
      {canUpdate && (
        <Section title="Atualizar situação">
          <DealForm
            opp={{ id: opp.id, version: opp.version, stage, lost, intendedGuarantee: opp.intendedGuarantee, inspectionNeeded: opp.inspectionNeeded }}
            lists={{ guarantees, agents, highlights, missing, lostReasons }}
            suggested={suggested}
            today={dayKey(new Date())}
            initialTo={para}
            canManageLists={global}
          />
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
              <p className="font-medium">
                {e.toStatus === "LOST" ? FELL_LABEL : e.toStage ? STAGE_LABEL[e.toStage as Stage] : e.fromStatus && e.fromStatus !== e.toStatus ? "Situação alterada" : "Em acompanhamento"}
              </p>
              {e.note && <p className="whitespace-pre-wrap text-ink-2">{e.note}</p>}
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
