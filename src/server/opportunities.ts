/**
 * Oportunidade cliente–imóvel.
 * - Visita realizada (positiva/ainda decidindo) entra na oportunidade ativa do par cliente+imóvel ou abre um novo ciclo.
 * - Visita realizada negativa encerra a oportunidade como perdida (origem: visita negativa).
 * - Fechamento exige data e responsável; perda posterior exige motivo e observação; reabertura exige observação.
 * - Um fechamento conta uma vez por oportunidade (não por visita).
 */
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, canUpdateOpportunity, canViewOpportunity, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { dateOnlyFromKey, dayKey, isDayKey } from "@/lib/time";
import type { OpportunityStatus } from "@/generated/prisma/enums";

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
  })
  .superRefine((v, ctx) => {
    if (v.toStatus === "CLOSED_WON" && !isDayKey(v.closedAt)) ctx.addIssue({ code: "custom", path: ["closedAt"], message: "Informe a data do fechamento." });
    if (v.toStatus === "LOST") {
      if (!v.lostReasonId) ctx.addIssue({ code: "custom", path: ["lostReasonId"], message: "Selecione o motivo da perda." });
      if (!v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "Descreva o motivo da perda." });
    }
  });

export async function updateOpportunity(actor: AuthzActor, oppId: string, input: z.input<typeof opportunityUpdateSchema>) {
  const data = opportunityUpdateSchema.parse(input);
  const settings = await getSettings();
  return db.$transaction(async (tx) => {
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
    if (data.toStatus === "CLOSED_WON") {
      const responsibleId = data.closedResponsibleId || opp.responsibleId || actor.id;
      if (data.closedResponsibleId && data.closedResponsibleId !== opp.responsibleId && !hasGlobalView(actor)) {
        throw new AppError("FORBIDDEN", "Somente a gestão pode registrar fechamento em nome de outra responsável.");
      }
      const resp = await tx.user.findUnique({ where: { id: responsibleId } });
      if (!resp) throw new AppError("VALIDATION", "Responsável inválida.");
      if (data.closedAt! > dayKey(new Date())) throw new AppError("VALIDATION", "A data do fechamento não pode ser futura.", { closedAt: "Data futura." });
      Object.assign(update, { closedAt: dateOnlyFromKey(data.closedAt!), closedResponsibleId: responsibleId, lostAt: null, lostOrigin: null, lostReasonId: null, lostNote: null });
    } else if (data.toStatus === "LOST") {
      const reason = await tx.reason.findUnique({ where: { id: data.lostReasonId! } });
      if (!reason || reason.kind !== "OPPORTUNITY_LOST" || !reason.active) throw new AppError("VALIDATION", "Motivo de perda inválido.");
      Object.assign(update, { lostAt: new Date(), lostOrigin: "LATER", lostReasonId: reason.id, lostNote: data.note, closedAt: null, closedResponsibleId: null });
    } else if (reopening) {
      Object.assign(update, { closedAt: null, closedResponsibleId: null, lostAt: null, lostOrigin: null, lostReasonId: null, lostNote: null });
    }
    try {
      await tx.opportunity.update({ where: { id: oppId }, data: update });
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
