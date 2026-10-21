/**
 * Oportunidade cliente–imóvel.
 * - Visita realizada (positiva/ainda decidindo) entra na oportunidade ativa do par cliente+imóvel ou abre um novo ciclo.
 * - Visita realizada negativa encerra a oportunidade como perdida (origem: visita negativa).
 * - Fechamento exige data e responsável; perda posterior exige motivo e observação; reabertura exige observação.
 * - Um fechamento conta uma vez por oportunidade (não por visita).
 */
import { closeSearchOnWin } from "./client-search";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, canUpdateOpportunity, canViewOpportunity, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { dateOnlyFromKey, dayKey, isDayKey } from "@/lib/time";
import type { OpportunityStatus } from "@/generated/prisma/enums";
import { appLink, emailConfig, sendEmail } from "@/lib/email";
import { notifyUser } from "./notify";

const ACTIVE: OpportunityStatus[] = ["FOLLOW_UP", "DOCS_REVIEW"];

/** Vincula uma visita realizada à oportunidade (idempotente). */
export async function applyDoneVisit(tx: Tx, visitId: string, actorId: string | null) {
  const v = await tx.visit.findUnique({ where: { id: visitId } });
  if (!v || v.status !== "DONE" || !v.clientId || !v.propertyId || v.excluded) return;
  if (v.opportunityId) return;

  let opp = await tx.opportunity.findFirst({
    where: { clientId: v.clientId, propertyId: v.propertyId, status: { in: ACTIVE } },
  });

  if (!opp) {
    const max = await tx.opportunity.aggregate({
      where: { clientId: v.clientId, propertyId: v.propertyId },
      _max: { cycle: true },
    });
    const cycle = (max._max.cycle ?? 0) + 1;
    opp = await tx.opportunity.create({
      data: {
        clientId: v.clientId,
        propertyId: v.propertyId,
        cycle,
        status: "FOLLOW_UP",
        responsibleId: v.realizedById ?? v.consultantId,
        firstDoneVisitAt: v.scheduledStart,
        events: {
          create: {
            toStatus: "FOLLOW_UP",
            note: cycle > 1 ? `Novo ciclo (${cycle}) aberto por visita realizada` : "Aberta por visita realizada",
            authorId: actorId,
          },
        },
      },
    });
  } else if (v.scheduledStart < opp.firstDoneVisitAt) {
    opp = await tx.opportunity.update({ where: { id: opp.id }, data: { firstDoneVisitAt: v.scheduledStart } });
  }

  await tx.visit.update({ where: { id: v.id }, data: { opportunityId: opp.id } });

  if (v.evaluation === "NEGATIVE") {
    await tx.opportunity.update({
      where: { id: opp.id },
      data: {
        status: "LOST",
        lostAt: new Date(),
        lostOrigin: "VISIT_NEGATIVE",
        lostReasonId: v.negativeReasonId,
        version: { increment: 1 },
        events: { create: { fromStatus: opp.status, toStatus: "LOST", note: "Encerrada por visita avaliada como negativa", authorId: actorId } },
      },
    });
  }
}

/** Desfaz o vínculo (correção de resultado/cliente/imóvel). Não apaga fechamentos. */
export async function detachVisitFromOpportunity(tx: Tx, visitId: string, actorId: string | null) {
  const v = await tx.visit.findUnique({ where: { id: visitId } });
  if (!v?.opportunityId) return;
  const opp = await tx.opportunity.findUnique({ where: { id: v.opportunityId } });
  await tx.visit.update({ where: { id: v.id }, data: { opportunityId: null } });
  if (!opp) return;

  const remaining = await tx.visit.findMany({
    where: { opportunityId: opp.id, status: "DONE" },
    orderBy: { scheduledStart: "asc" },
  });
  if (remaining.length === 0 && opp.status !== "CLOSED_WON") {
    await tx.opportunity.delete({ where: { id: opp.id } });
    await audit(tx, { actorId, action: "opportunity.removed_no_visits", entityType: "Opportunity", entityId: opp.id });
    return;
  }
  const data: Record<string, unknown> = {};
  if (remaining.length) data.firstDoneVisitAt = remaining[0].scheduledStart;
  if (opp.status === "LOST" && opp.lostOrigin === "VISIT_NEGATIVE" && v.evaluation === "NEGATIVE") {
    const clash = await tx.opportunity.findFirst({
      where: { clientId: opp.clientId, propertyId: opp.propertyId, status: { in: ACTIVE }, id: { not: opp.id } },
    });
    if (!clash) {
      Object.assign(data, { status: "FOLLOW_UP", lostAt: null, lostOrigin: null, lostReasonId: null, lostNote: null });
      await tx.opportunityEvent.create({
        data: { opportunityId: opp.id, fromStatus: "LOST", toStatus: "FOLLOW_UP", note: "Reaberta por correção da avaliação da visita", authorId: actorId },
      });
    }
  }
  if (Object.keys(data).length) await tx.opportunity.update({ where: { id: opp.id }, data: { ...data, version: { increment: 1 } } });
}

export const opportunityUpdateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    toStatus: z.enum(["FOLLOW_UP", "DOCS_REVIEW", "CLOSED_WON", "LOST"]),
    note: z.string().trim().max(2000).optional().default(""),
    closedAt: z.string().optional(),
    closedResponsibleId: z.string().optional(),
    lostReasonId: z.string().optional(),
    /** aviso ao marketing (obrigatórios no fechamento): agenciador, diferenciais marcados e texto */
    agentId: z.string().optional(),
    highlightIds: z.array(z.string()).max(20).optional().default([]),
    highlightNote: z.string().trim().max(600).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.toStatus === "CLOSED_WON" && !isDayKey(v.closedAt)) ctx.addIssue({ code: "custom", path: ["closedAt"], message: "Informe a data do fechamento." });
    if (v.toStatus === "CLOSED_WON" && !v.agentId) ctx.addIssue({ code: "custom", path: ["agentId"], message: "Escolha o agenciador." });
    if (v.toStatus === "CLOSED_WON" && v.highlightNote.length < 5) ctx.addIssue({ code: "custom", path: ["highlightNote"], message: "Conte o diferencial desta locação para o marketing." });
    if (v.toStatus === "LOST") {
      if (!v.lostReasonId) ctx.addIssue({ code: "custom", path: ["lostReasonId"], message: "Selecione o motivo da perda." });
      if (!v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "Descreva o motivo da perda." });
    }
  });

export async function updateOpportunity(actor: AuthzActor, oppId: string, input: z.input<typeof opportunityUpdateSchema>) {
  const parsed = opportunityUpdateSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Revise os campos destacados.", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
  const data = parsed.data;
  const settings = await getSettings();
  const post = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${oppId} FOR UPDATE`;
    const opp = await tx.opportunity.findUnique({ where: { id: oppId } });
    if (!opp || !canViewOpportunity(actor, opp)) throw notFound();
    assert(canUpdateOpportunity(actor, opp, settings));
    if (opp.version !== data.expectedVersion) {
      throw new AppError("CONFLICT", "Esta oportunidade foi alterada por outra pessoa. Recarregue para ver a versão atual.");
    }
    if (opp.status === data.toStatus) throw new AppError("INVALID_STATE", "A oportunidade já está nesta situação.");
    const reopening = !ACTIVE.includes(opp.status) && ACTIVE.includes(data.toStatus);
    if (reopening && !data.note) throw new AppError("VALIDATION", "Informe uma observação para reabrir.", { note: "Obrigatória para reabrir." });

    const update: Record<string, unknown> = { status: data.toStatus, version: { increment: 1 } };
    let leaseInfo: { agentId: string; highlights: string[]; highlightNote: string } | null = null;
    if (data.toStatus === "CLOSED_WON") {
      const responsibleId = data.closedResponsibleId || opp.responsibleId || actor.id;
      if (data.closedResponsibleId && data.closedResponsibleId !== opp.responsibleId && !hasGlobalView(actor)) {
        throw new AppError("FORBIDDEN", "Somente a gestão pode registrar fechamento em nome de outra responsável.");
      }
      const resp = await tx.user.findUnique({ where: { id: responsibleId } });
      if (!resp) throw new AppError("VALIDATION", "Responsável inválida.");
      if (data.closedAt! > dayKey(new Date())) throw new AppError("VALIDATION", "A data do fechamento não pode ser futura.", { closedAt: "Data futura." });
      Object.assign(update, { closedAt: dateOnlyFromKey(data.closedAt!), closedResponsibleId: responsibleId, lostAt: null, lostOrigin: null, lostReasonId: null, lostNote: null });
      const agent = await tx.reason.findUnique({ where: { id: data.agentId! } });
      if (!agent || agent.kind !== "LEASE_AGENT" || !agent.active) throw new AppError("VALIDATION", "Escolha o agenciador.", { agentId: "Agenciador inválido." });
      const highlights = data.highlightIds.length ? await tx.reason.findMany({ where: { id: { in: data.highlightIds }, kind: "LEASE_HIGHLIGHT" }, orderBy: { sortOrder: "asc" } }) : [];
      leaseInfo = { agentId: agent.id, highlights: highlights.map((h) => h.label), highlightNote: data.highlightNote };
    } else if (data.toStatus === "LOST") {
      const reason = await tx.reason.findUnique({ where: { id: data.lostReasonId! } });
      if (!reason || reason.kind !== "OPPORTUNITY_LOST" || !reason.active) throw new AppError("VALIDATION", "Motivo de perda inválido.");
      Object.assign(update, { lostAt: new Date(), lostOrigin: "LATER", lostReasonId: reason.id, lostNote: data.note, closedAt: null, closedResponsibleId: null });
    } else if (reopening) {
      Object.assign(update, { closedAt: null, closedResponsibleId: null, lostAt: null, lostOrigin: null, lostReasonId: null, lostNote: null });
    }
    try {
      await tx.opportunity.update({ where: { id: oppId }, data: update });
      if (data.toStatus === "CLOSED_WON") await closeSearchOnWin(tx, opp.clientId, actor.id);
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        throw new AppError("INVALID_STATE", "Já existe outra oportunidade ativa para este cliente e imóvel.");
      }
      throw e;
    }
    await tx.opportunityEvent.create({
      data: { opportunityId: oppId, fromStatus: opp.status, toStatus: data.toStatus, note: data.note || null, authorId: actor.id },
    });
    await audit(tx, {
      actorId: actor.id,
      action: reopening ? "opportunity.reopened" : "opportunity.status_changed",
      entityType: "Opportunity",
      entityId: oppId,
      changes: { de: opp.status, para: data.toStatus, closedAt: data.closedAt ?? null },
    });
    // aviso ao marketing: criado no fechamento; saiu de "fechada" antes de postar → o aviso some
    if (leaseInfo) {
      await tx.leasePost.upsert({ where: { opportunityId: oppId }, update: { ...leaseInfo, createdById: actor.id, createdAt: new Date(), postedAt: null, postedById: null }, create: { opportunityId: oppId, ...leaseInfo, createdById: actor.id } });
      return true;
    }
    if (opp.status === "CLOSED_WON") await tx.leasePost.deleteMany({ where: { opportunityId: oppId, postedAt: null } });
    return false;
  });
  if (post) await notifyMarketing(oppId).catch(() => undefined);
}

/** Avisa o marketing (celular e, se configurado, e-mail) de uma locação fechada para postar. */
export async function notifyMarketing(oppId: string) {
  const o = await db.opportunity.findUnique({ where: { id: oppId }, include: { property: { select: { code: true, neighborhood: true } }, leasePost: { include: { agent: { select: { label: true } } } } } });
  if (!o?.leasePost) return;
  const people = await db.user.findMany({ where: { role: "MARKETING", active: true }, select: { id: true, email: true } });
  const where = `imóvel ${o.property.code}${o.property.neighborhood ? ` · ${o.property.neighborhood}` : ""}`;
  const highlight = o.leasePost.highlights[0] ?? o.leasePost.highlightNote;
  for (const u of people) {
    await notifyUser(u.id, { title: "Locação fechada para postar", body: `${where}. ${highlight}`.slice(0, 180), url: "/marketing", tag: `locacao-${oppId}` });
    if (emailConfig()) {
      await sendEmail(
        u.email,
        `Locação fechada: ${where}`,
        [`Contrato assinado — ${where}.`, `Agenciador: ${o.leasePost.agent.label}`, o.leasePost.highlights.length ? `Diferenciais: ${o.leasePost.highlights.join(", ")}` : "", `Sobre a locação: ${o.leasePost.highlightNote}`, "", `Ver no app: ${appLink("/marketing")}`].filter(Boolean).join("\n"),
      );
    }
  }
}

/** Marketing marca a locação como postada (ou desfaz). */
export async function markLeasePosted(actor: AuthzActor, postId: string, posted: boolean) {
  assert(actor.role === "MARKETING" || hasGlobalView(actor));
  await db.$transaction(async (tx) => {
    const p = await tx.leasePost.findUnique({ where: { id: postId } });
    if (!p) throw notFound();
    await tx.leasePost.update({ where: { id: postId }, data: posted ? { postedAt: new Date(), postedById: actor.id } : { postedAt: null, postedById: null } });
    await audit(tx, { actorId: actor.id, action: posted ? "lease_post.posted" : "lease_post.unposted", entityType: "LeasePost", entityId: postId });
  });
}

/** Gestão: transfere a responsável (histórico preservado; fechamentos anteriores mantêm a responsável registrada). */
export async function transferOpportunity(actor: AuthzActor, oppId: string, responsibleId: string, note: string) {
  assert(hasGlobalView(actor));
  return db.$transaction(async (tx) => {
    const opp = await tx.opportunity.findUnique({ where: { id: oppId } });
    if (!opp) throw notFound();
    const user = await tx.user.findUnique({ where: { id: responsibleId } });
    if (!user || !user.active) throw new AppError("VALIDATION", "Responsável inválida.");
    await tx.opportunity.update({ where: { id: oppId }, data: { responsibleId, version: { increment: 1 } } });
    await tx.opportunityEvent.create({
      data: { opportunityId: oppId, fromStatus: opp.status, toStatus: opp.status, note: `Responsável alterada para ${user.name}${note ? ` — ${note}` : ""}`, authorId: actor.id },
    });
    await audit(tx, { actorId: actor.id, action: "opportunity.transferred", entityType: "Opportunity", entityId: oppId, changes: { de: opp.responsibleId, para: responsibleId } });
  });
}
