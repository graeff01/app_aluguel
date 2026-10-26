/**
 * Fluxo pós-visita: a consultora atualiza a Situação a cada etapa, até a posse. Cada mudança guarda a data
 * (tempo entre etapas) e os dados da etapa. "Caiu" em qualquer etapa exige a etapa e o motivo (lista fechada).
 * O status antigo (acompanhamento/documentação/fechada/perdida) acompanha a situação para os indicadores de sempre.
 */
import { closeSearchOnWin } from "./client-search";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, canUpdateOpportunity, canViewOpportunity, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { dateOnlyFromKey, dayKey, isDayKey } from "@/lib/time";
import { DEAL_STAGES, STAGE_LABEL, coarseStatus, stageIndex, type Stage } from "@/lib/deal-stages";
import { parseMoney } from "./pre-analysis";
import { notifyMarketing } from "./opportunities";

export type StageInput = {
  expectedVersion: number;
  to: Stage | "FELL";
  note?: string;
  proposedRent?: string;
  intendedGuarantee?: string;
  proposalSentAt?: string;
  ownerAcceptedAt?: string;
  agreedRent?: string;
  kycSentAt?: string;
  kycDueAt?: string;
  guarantee?: string;
  analysisDecidedAt?: string;
  docsMissingIds?: string[];
  docsRequestedAt?: string;
  contractReleasedAt?: string;
  contractSentAt?: string;
  inspectionNeeded?: string;
  signedAt?: string;
  dealType?: string;
  contractValue?: string;
  agentId?: string;
  highlightIds?: string[];
  highlightNote?: string;
  possessionAt?: string;
  keysHolderChecked?: boolean;
  lostReasonId?: string;
};

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const br = (k: string) => k.split("-").reverse().join("/");

export async function moveDealStage(actor: AuthzActor, oppId: string, input: StageInput, now = new Date()) {
  const settings = await getSettings();
  const today = dayKey(now);
  const errors: Record<string, string> = {};
  const date = (field: keyof StageInput, label: string, required = true) => {
    const v = (input[field] as string | undefined)?.trim();
    if (!v) {
      if (required) errors[field] = `Informe ${label}.`;
      return null;
    }
    if (!isDayKey(v)) errors[field] = "Data inválida.";
    else if (v > today && field !== "kycDueAt") errors[field] = "A data não pode ser futura.";
    return isDayKey(v) ? v : null;
  };
  const money = (field: keyof StageInput, label: string) => {
    const c = parseMoney((input[field] as string | undefined) ?? "");
    if (!c) errors[field] = `Informe ${label} (ex.: 2.300,00).`;
    return c;
  };
  const listLabel = async (kind: "GUARANTEE", field: keyof StageInput, label: string) => {
    const id = (input[field] as string | undefined) ?? "";
    const r = id ? await db.reason.findUnique({ where: { id } }) : null;
    if (!r || r.kind !== kind) errors[field] = `Escolha ${label}.`;
    return r?.label ?? null;
  };

  const data: Record<string, unknown> = {};
  const summary: string[] = [];
  let lease: { agentId: string; highlights: string[]; highlightNote: string } | null = null;
  const to = input.to;
  if (to === "NEGOTIATION") {
    const v = money("proposedRent", "o valor proposto");
    const g = await listLabel("GUARANTEE", "intendedGuarantee", "a garantia pretendida");
    Object.assign(data, { proposedRentCents: v, intendedGuarantee: g });
    if (v && g) summary.push(`Valor proposto ${brl(v)} · garantia pretendida ${g}`);
  } else if (to === "OWNER_PENDING") {
    const d = date("proposalSentAt", "a data do envio da proposta");
    Object.assign(data, { proposalSentAt: d && dateOnlyFromKey(d) });
    if (d) summary.push(`Proposta enviada em ${br(d)}`);
  } else if (to === "PRE_ANALYSIS") {
    const a = date("ownerAcceptedAt", "a data do aceite do proprietário");
    const v = money("agreedRent", "o valor final acordado");
    Object.assign(data, { ownerAcceptedAt: a && dateOnlyFromKey(a), agreedRentCents: v });
    if (a && v) summary.push(`Aceite em ${br(a)} · valor final ${brl(v)}`);
  } else if (to === "KYC_SENT") {
    const s = date("kycSentAt", "a data do envio do link de cadastro");
    const due = date("kycDueAt", "o prazo combinado para preencher");
    if (s && due && due < s) errors.kycDueAt = "O prazo deve ser depois do envio.";
    const missing = input.docsMissingIds?.length ? await db.reason.findMany({ where: { id: { in: input.docsMissingIds }, kind: "PRE_MISSING" }, orderBy: { sortOrder: "asc" } }) : [];
    Object.assign(data, { kycSentAt: s && dateOnlyFromKey(s), kycDueAt: due && dateOnlyFromKey(due), docsRequestedAt: s && dateOnlyFromKey(s), docsMissing: missing.map((m) => m.label) });
    if (s && due) summary.push(`KYC enviado em ${br(s)}, prazo ${br(due)}${missing.length ? ` · falta: ${missing.map((m) => m.label).join(", ")}` : ""}`);
  } else if (to === "APPROVED") {
    const g = await listLabel("GUARANTEE", "guarantee", "a garantia definida");
    const d = date("analysisDecidedAt", "a data da aprovação");
    Object.assign(data, { guarantee: g, analysisDecidedAt: d && dateOnlyFromKey(d), docsMissing: [] });
    if (g && d) summary.push(`Aprovado em ${br(d)} · garantia ${g}`);
  } else if (to === "INSPECTION") {
    if (!["sim", "nao"].includes(input.inspectionNeeded ?? "")) errors.inspectionNeeded = "Diga se tem vistoria.";
    Object.assign(data, { inspectionNeeded: input.inspectionNeeded === "sim" });
    summary.push(`Contrato pedido ao ADM · ${input.inspectionNeeded === "sim" ? "com vistoria" : "sem vistoria"}`);
  } else if (to === "CONTRACT") {
    const r = date("contractReleasedAt", "a data de liberação do contrato");
    const s = date("contractSentAt", "a data de envio do contrato", false);
    // vistoria: respondida em "Aguardando vistoria" (ou aqui, se a etapa foi pulada)
    const insp = input.inspectionNeeded === "sim" ? true : input.inspectionNeeded === "nao" ? false : undefined;
    if (insp === undefined && (await db.opportunity.findUnique({ where: { id: oppId }, select: { inspectionNeeded: true } }))?.inspectionNeeded == null) errors.inspectionNeeded = "Diga se tem vistoria.";
    Object.assign(data, { contractReleasedAt: r && dateOnlyFromKey(r), contractSentAt: s && dateOnlyFromKey(s), ...(insp === undefined ? {} : { inspectionNeeded: insp }) });
    if (r) summary.push(`Contrato liberado em ${br(r)}${s ? ` · enviado em ${br(s)}` : ""}${insp === undefined ? "" : insp ? " · com vistoria" : " · sem vistoria"}`);
  } else if (to === "SIGNED") {
    const d = date("signedAt", "a data real da assinatura");
    if (input.dealType !== "LEASE" && input.dealType !== "INTERMEDIATION") errors.dealType = "Escolha o tipo de negócio.";
    const v = money("contractValue", "o valor do contrato");
    const agent = input.agentId ? await db.reason.findUnique({ where: { id: input.agentId } }) : null;
    if (!agent || agent.kind !== "LEASE_AGENT" || !agent.active) errors.agentId = "Escolha o agenciador.";
    const note = (input.highlightNote ?? "").trim();
    if (note.length < 5) errors.highlightNote = "Conte o diferencial desta locação para o marketing.";
    const highlights = input.highlightIds?.length ? await db.reason.findMany({ where: { id: { in: input.highlightIds }, kind: "LEASE_HIGHLIGHT" }, orderBy: { sortOrder: "asc" } }) : [];
    Object.assign(data, { signedAt: d && dateOnlyFromKey(d), closedAt: d && dateOnlyFromKey(d), dealType: input.dealType, contractValueCents: v });
    if (agent) lease = { agentId: agent.id, highlights: highlights.map((h) => h.label), highlightNote: note };
    if (d && v) summary.push(`Assinado em ${br(d)} · ${input.dealType === "INTERMEDIATION" ? "só intermediação" : "locação"} · ${brl(v)}`);
  } else if (to === "POSSESSION") {
    const d = date("possessionAt", "a data da posse");
    if (!input.keysHolderChecked) errors.keysHolderChecked = "Confirme a retirada pelo titular com o documento no verso do protocolo.";
    Object.assign(data, { possessionAt: d && dateOnlyFromKey(d), keysHolderChecked: true });
    if (d) summary.push(`Posse em ${br(d)} · chaves retiradas pelo titular`);
  } else if (to === "FELL") {
    const r = input.lostReasonId ? await db.reason.findUnique({ where: { id: input.lostReasonId } }) : null;
    if (!r || r.kind !== "OPPORTUNITY_LOST" || !r.active) errors.lostReasonId = "Escolha o motivo.";
    if (!(input.note ?? "").trim()) errors.note = "Descreva o que aconteceu.";
    if (r) summary.push(`Motivo: ${r.label}`);
    Object.assign(data, { lostReasonId: r?.id, lostNote: (input.note ?? "").trim() });
  } else if (to !== "ANALYSIS") {
    throw new AppError("VALIDATION", "Situação inválida.");
  }
  if (Object.keys(errors).length) throw new AppError("VALIDATION", "Revise os campos destacados.", errors);

  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${oppId} FOR UPDATE`;
    const opp = await tx.opportunity.findUnique({ where: { id: oppId } });
    if (!opp || !canViewOpportunity(actor, opp)) throw notFound();
    assert(canUpdateOpportunity(actor, opp, settings));
    if (opp.version !== input.expectedVersion) throw new AppError("CONFLICT", "Este negócio foi alterado por outra pessoa. Recarregue para ver a versão atual.");
    const fromStage = opp.stage as Stage | null;
    const lost = opp.status === "LOST";
    if (to === "FELL" && lost) throw new AppError("INVALID_STATE", "Este negócio já está como Caiu.");
    if (to !== "FELL" && !lost && to === fromStage) throw new AppError("INVALID_STATE", "O negócio já está nesta situação.");
    // voltar uma etapa (ou reabrir o que caiu) é correção: pede o porquê
    const back = to !== "FELL" && (lost || stageIndex(to) < stageIndex(fromStage));
    if (back && !(input.note ?? "").trim()) throw new AppError("VALIDATION", "Diga o motivo de voltar a situação.", { note: "Obrigatório para voltar." });

    const update: Record<string, unknown> = { ...data, version: { increment: 1 }, stageChangedAt: now };
    if (to === "FELL") Object.assign(update, { status: "LOST", lostAt: now, lostOrigin: "LATER", lostStage: fromStage, closedAt: null, closedResponsibleId: null });
    else {
      Object.assign(update, { stage: to, status: coarseStatus(to) });
      if (lost) Object.assign(update, { lostAt: null, lostOrigin: null, lostReasonId: null, lostNote: null, lostStage: null });
      if (to === "SIGNED") update.closedResponsibleId = opp.responsibleId ?? actor.id;
      if (coarseStatus(to) !== "CLOSED_WON") Object.assign(update, { closedAt: null, closedResponsibleId: null });
    }
    await tx.opportunity.update({ where: { id: oppId }, data: update });
    await tx.opportunityEvent.create({
      data: {
        opportunityId: oppId,
        fromStatus: opp.status,
        toStatus: to === "FELL" ? "LOST" : coarseStatus(to),
        fromStage,
        toStage: to === "FELL" ? null : to,
        note: [summary.join(" · "), (input.note ?? "").trim()].filter(Boolean).join(" — ") || null,
        authorId: actor.id,
      },
    });
    await audit(tx, { actorId: actor.id, action: "deal.stage_changed", entityType: "Opportunity", entityId: oppId, changes: { de: fromStage ?? (lost ? "CAIU" : null), para: to } });
    // cliente que estava "em busca" alugou conosco
    if (to === "SIGNED") await closeSearchOnWin(tx, opp.clientId, actor.id, now);
    // marketing: contrato assinado gera o aviso; sair de "assinado" antes de postar retira
    if (to === "SIGNED" && lease) {
      await tx.leasePost.upsert({ where: { opportunityId: oppId }, update: { ...lease, createdById: actor.id, createdAt: now, postedAt: null, postedById: null }, create: { opportunityId: oppId, ...lease, createdById: actor.id } });
      return { notify: true };
    }
    if (coarseStatus(fromStage) === "CLOSED_WON" && (to === "FELL" || coarseStatus(to) !== "CLOSED_WON")) await tx.leasePost.deleteMany({ where: { opportunityId: oppId, postedAt: null } });
    return { notify: false };
  });
  if (result.notify) await notifyMarketing(oppId).catch(() => undefined);
  return { to, label: to === "FELL" ? "Caiu" : STAGE_LABEL[to] };
}

// ─────────────── Indicadores do fluxo ───────────────

const DAY = 86400_000;

/** Funil por situação (coorte da 1ª visita no período), onde cai, tempo médio em cada etapa e VGL do período. */
export async function dealFunnel(actor: AuthzActor, f: { from: Date; to: Date; consultantId?: string | null }) {
  assert(hasGlobalView(actor) || !!f.consultantId);
  const scope = hasGlobalView(actor) ? (f.consultantId ? { responsibleId: f.consultantId } : {}) : { responsibleId: actor.id };
  const opps = await db.opportunity.findMany({
    where: { ...scope, firstDoneVisitAt: { gte: f.from, lt: f.to } },
    select: { id: true, stage: true, status: true, lostStage: true, events: { select: { toStage: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
  });
  const reached = DEAL_STAGES.map((s) => ({
    stage: s,
    label: STAGE_LABEL[s],
    count: opps.filter((o) => Math.max(stageIndex(o.stage as Stage | null), stageIndex(o.lostStage as Stage | null), ...o.events.map((e) => stageIndex(e.toStage as Stage | null))) >= stageIndex(s)).length,
    lost: opps.filter((o) => o.status === "LOST" && o.lostStage === s).length,
  }));
  // tempo em cada etapa: da entrada nela até a entrada na seguinte
  const durations = new Map<Stage, number[]>();
  for (const o of opps) {
    const ev = o.events.filter((e) => e.toStage);
    for (let i = 0; i < ev.length - 1; i++) {
      const s = ev[i].toStage as Stage;
      durations.set(s, [...(durations.get(s) ?? []), (ev[i + 1].createdAt.getTime() - ev[i].createdAt.getTime()) / DAY]);
    }
  }
  const avgDays = Object.fromEntries(DEAL_STAGES.map((s) => {
    const xs = durations.get(s) ?? [];
    return [s, xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null];
  })) as Record<Stage, number | null>;
  // VGL: contratos assinados no período (pela data da assinatura)
  const signed = await db.opportunity.findMany({
    where: { ...scope, signedAt: { gte: new Date(dayKey(f.from) + "T00:00:00Z"), lt: new Date(dayKey(f.to) + "T00:00:00Z") }, status: { not: "LOST" } },
    select: { contractValueCents: true, dealType: true },
  });
  const vgl = signed.reduce((a, s) => a + (s.contractValueCents ?? 0), 0);
  return {
    total: opps.length,
    reached,
    lostNoStage: opps.filter((o) => o.status === "LOST" && !o.lostStage).length,
    avgDays,
    vgl: { totalCents: vgl, contracts: signed.length, lease: signed.filter((s) => s.dealType === "LEASE").length, intermediation: signed.filter((s) => s.dealType === "INTERMEDIATION").length },
  };
}
