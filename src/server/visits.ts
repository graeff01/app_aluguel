/**
 * Visitas: conclusão (resultado), correção de dados, atribuição, cadastro manual e conflitos de sincronização.
 * Toda função recebe o ator autenticado e aplica src/lib/authz.ts no servidor.
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import {
  assert,
  canAssignVisit,
  canConcludeVisit,
  canCorrectVisitData,
  canCreateManualVisit,
  canReview,
  canViewVisit,
  hasGlobalView,
  type AuthzActor,
} from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { normalizePhone } from "@/lib/phone";
import { cleanOptional } from "@/lib/text";
import { fromLocalInput } from "@/lib/time";
import { resolveClient, cleanupOrphanClient } from "./clients";
import { applyDoneVisit, detachVisitFromOpportunity } from "./opportunities";

export async function ensureProperty(tx: Tx, code: string | null | undefined): Promise<string | null> {
  const c = cleanOptional(code);
  if (!c) return null;
  const p = await tx.property.upsert({ where: { code: c }, update: {}, create: { code: c } });
  return p.id;
}

/** Problemas de dados que exigem correção/identificação. */
export function dataIssues(v: { clientName: string | null; propertyCode: string | null; phoneRaw: string | null; phoneNormalized: string | null }) {
  const issues: ("MISSING_NAME" | "MISSING_CODE" | "MISSING_PHONE" | "INVALID_PHONE")[] = [];
  if (!v.clientName?.trim()) issues.push("MISSING_NAME");
  if (!v.propertyCode?.trim()) issues.push("MISSING_CODE");
  if (!v.phoneRaw?.trim()) issues.push("MISSING_PHONE");
  else if (!v.phoneNormalized) issues.push("INVALID_PHONE");
  return issues;
}

// ─────────────── Conclusão ───────────────

export const conclusionSchema = z
  .object({
    requestId: z.string().min(8).max(100),
    expectedVersion: z.number().int().positive(),
    status: z.enum(["DONE", "NO_SHOW", "CANCELED", "RESCHEDULED"]),
    evaluation: z.enum(["POSITIVE", "NEGATIVE", "UNDECIDED"]).nullable().optional(),
    negativeReasonId: z.string().nullable().optional(),
    note: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "DONE" && !v.evaluation) ctx.addIssue({ code: "custom", path: ["evaluation"], message: "Selecione o resultado da visita." });
    if (v.status !== "DONE" && v.evaluation) ctx.addIssue({ code: "custom", path: ["evaluation"], message: "Resultado só se aplica a visita realizada." });
    if (v.evaluation === "NEGATIVE" && !v.negativeReasonId) ctx.addIssue({ code: "custom", path: ["negativeReasonId"], message: "Selecione o motivo principal." });
  });

export type ConclusionInput = z.input<typeof conclusionSchema>;

export async function concludeVisit(actor: AuthzActor, visitId: string, input: ConclusionInput, now = new Date()) {
  const parsed = conclusionSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "Revise os campos destacados.", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
  }
  const data = parsed.data;
  const settings = await getSettings();
  const note = data.note.trim();
  if (!note) throw new AppError("VALIDATION", "A observação é obrigatória.", { note: "Escreva uma observação." });
  if (note.length > settings.noteMaxLength) {
    throw new AppError("VALIDATION", `A observação pode ter até ${settings.noteMaxLength} caracteres.`, { note: "Texto muito longo." });
  }

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id = ${visitId} FOR UPDATE`;
    const visit = await tx.visit.findUnique({ where: { id: visitId } });
    if (!visit || !canViewVisit(actor, visit)) throw notFound();
    assert(canConcludeVisit(actor, visit));

    // Repetição da mesma requisição (duplo clique / retry de rede): devolve o resultado já gravado.
    if (visit.lastRequestId === data.requestId) return { visit, idempotent: true as const };

    if (visit.version !== data.expectedVersion) {
      throw new AppError("CONFLICT", "Esta visita foi alterada enquanto você preenchia. Seu texto foi mantido; confira a versão atual antes de salvar novamente.", {
        currentVersion: visit.version,
        currentStatus: visit.status,
      });
    }
    if (visit.excluded) throw new AppError("INVALID_STATE", "Esta visita foi excluída dos indicadores pela gestão.");
    if ((data.status === "DONE" || data.status === "NO_SHOW") && visit.scheduledStart.getTime() > now.getTime() + 15 * 60_000) {
      throw new AppError("VALIDATION", "A visita ainda não começou. Para visitas futuras use cancelada ou remarcada.");
    }
    if (data.status === "DONE") {
      const missing: Record<string, string> = {};
      if (!visit.clientName?.trim()) missing.clientName = "Informe o nome do cliente.";
      if (!visit.propertyCode?.trim()) missing.propertyCode = "Informe o código do imóvel.";
      if (Object.keys(missing).length) throw new AppError("MISSING_DATA", "Complete os dados da visita antes de concluir.", missing);
    }
    if (data.evaluation === "NEGATIVE") {
      const reason = await tx.reason.findUnique({ where: { id: data.negativeReasonId! } });
      const keepsOld = reason?.id === visit.negativeReasonId;
      if (!reason || reason.kind !== "VISIT_NEGATIVE" || (!reason.active && !keepsOld)) {
        throw new AppError("VALIDATION", "Motivo inválido.", { negativeReasonId: "Selecione um motivo da lista." });
      }
    }

    const changedOppInputs =
      visit.status !== data.status || visit.evaluation !== (data.evaluation ?? null) || visit.negativeReasonId !== (data.negativeReasonId ?? null);
    if (changedOppInputs) await detachVisitFromOpportunity(tx, visit.id, actor.id);

    const propertyId = visit.propertyId ?? (await ensureProperty(tx, visit.propertyCode));
    const updated = await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: data.status,
        evaluation: data.status === "DONE" ? data.evaluation! : null,
        negativeReasonId: data.evaluation === "NEGATIVE" ? data.negativeReasonId! : null,
        note,
        concludedAt: now,
        concludedById: actor.id,
        realizedById: data.status === "DONE" ? (visit.realizedById && visit.status === "DONE" ? visit.realizedById : visit.consultantId) : null,
        autoCanceled: false,
        propertyId,
        version: { increment: 1 },
        lastRequestId: data.requestId,
      },
    });
    await tx.visitOutcomeHistory.create({
      data: {
        visitId: visit.id,
        status: data.status,
        evaluation: updated.evaluation,
        negativeReasonId: updated.negativeReasonId,
        note,
        authorId: actor.id,
      },
    });
    await audit(tx, {
      actorId: actor.id,
      action: visit.status === "SCHEDULED" || visit.autoCanceled ? "visit.concluded" : "visit.outcome_changed",
      entityType: "Visit",
      entityId: visit.id,
      changes: diff(
        { status: visit.status, evaluation: visit.evaluation, negativeReasonId: visit.negativeReasonId },
        { status: updated.status, evaluation: updated.evaluation, negativeReasonId: updated.negativeReasonId },
      ),
    });
    if (changedOppInputs || !updated.opportunityId) await applyDoneVisit(tx, visit.id, actor.id);
    const fresh = await tx.visit.findUniqueOrThrow({ where: { id: visit.id } });
    return { visit: fresh, idempotent: false as const };
  });
}

// ─────────────── Correção de dados ───────────────

export const correctionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  clientName: z.string().max(200).optional(),
  phoneRaw: z.string().max(40).optional(),
  propertyCode: z.string().max(40).optional(),
  scheduledStart: z.string().optional(),
  scheduledEnd: z.string().optional(),
  reason: z.string().max(500).optional(),
});

export async function correctVisitData(actor: AuthzActor, visitId: string, input: z.input<typeof correctionSchema>) {
  const data = correctionSchema.parse(input);
  const settings = await getSettings();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id = ${visitId} FOR UPDATE`;
    const visit = await tx.visit.findUnique({ where: { id: visitId } });
    if (!visit || !canViewVisit(actor, visit)) throw notFound();
    assert(canCorrectVisitData(actor, visit, settings));
    if (visit.version !== data.expectedVersion) throw new AppError("CONFLICT", "A visita foi alterada por outra pessoa. Recarregue antes de corrigir.");

    const changes: Record<string, unknown> = {};
    const manual = new Set(visit.manualFields);
    if (data.clientName !== undefined && cleanOptional(data.clientName) !== visit.clientName) {
      changes.clientName = cleanOptional(data.clientName);
      manual.add("clientName");
    }
    if (data.phoneRaw !== undefined && (cleanOptional(data.phoneRaw) ?? null) !== visit.phoneRaw) {
      const p = normalizePhone(data.phoneRaw);
      changes.phoneRaw = cleanOptional(data.phoneRaw);
      changes.phoneNormalized = p.normalized;
      manual.add("phone");
    }
    if (data.propertyCode !== undefined && cleanOptional(data.propertyCode) !== visit.propertyCode) {
      changes.propertyCode = cleanOptional(data.propertyCode);
      changes.propertyId = await ensureProperty(tx, data.propertyCode);
      manual.add("propertyCode");
    }
    if (data.scheduledStart || data.scheduledEnd) {
      if (visit.origin !== "MANUAL") throw new AppError("VALIDATION", "O horário de visitas importadas vem da agenda Google. Corrija o evento na agenda.");
      const start = data.scheduledStart ? fromLocalInput(data.scheduledStart) : visit.scheduledStart;
      const end = data.scheduledEnd ? fromLocalInput(data.scheduledEnd) : visit.scheduledEnd;
      if (!start || !end || end < start) throw new AppError("VALIDATION", "Horário inválido.", { scheduledEnd: "O fim deve ser após o início." });
      changes.scheduledStart = start;
      changes.scheduledEnd = end;
    }
    if (Object.keys(changes).length === 0) return visit;

    const identityChanged = "clientName" in changes || "phoneRaw" in changes;
    const propertyChanged = "propertyId" in changes;
    if (identityChanged || propertyChanged) await detachVisitFromOpportunity(tx, visit.id, actor.id);

    let clientUpdate = {};
    if (identityChanged && visit.clientMatch !== "CONFIRMED_MANUAL") {
      const link = await resolveClient(tx, {
        clientName: (changes.clientName as string | null | undefined) ?? visit.clientName,
        phoneRaw: "phoneRaw" in changes ? (changes.phoneRaw as string | null) : visit.phoneRaw,
        currentClientId: visit.clientId,
      });
      clientUpdate = link;
    }
    await tx.visit.update({
      where: { id: visit.id },
      data: { ...changes, ...clientUpdate, manualFields: [...manual], version: { increment: 1 } },
    });
    if (identityChanged && "clientId" in clientUpdate && clientUpdate.clientId !== visit.clientId) {
      await cleanupOrphanClient(tx, visit.clientId);
    }
    await audit(tx, {
      actorId: actor.id,
      action: "visit.data_corrected",
      entityType: "Visit",
      entityId: visit.id,
      changes: { campos: Object.keys(changes), motivo: data.reason ?? null },
    });
    await applyDoneVisit(tx, visit.id, actor.id);
    return tx.visit.findUniqueOrThrow({ where: { id: visit.id } });
  });
}

// ─────────────── Atribuição ───────────────

export async function assignVisit(actor: AuthzActor, visitId: string, consultantId: string, note: string) {
  assert(canAssignVisit(actor));
  return db.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({ where: { id: visitId } });
    if (!visit) throw notFound();
    const consultant = await tx.user.findUnique({ where: { id: consultantId } });
    if (!consultant || consultant.role !== "CONSULTANT" || !consultant.active) throw new AppError("VALIDATION", "Consultora inválida.");
    const manual = new Set(visit.manualFields);
    manual.add("consultantId");
    await tx.visit.update({
      where: { id: visitId },
      data: {
        consultantId,
        assignmentStatus: "MANUAL",
        assignmentNote: "CORRECAO_MANUAL",
        manualFields: [...manual],
        version: { increment: 1 },
      },
    });
    await audit(tx, {
      actorId: actor.id,
      action: "visit.assigned",
      entityType: "Visit",
      entityId: visitId,
      changes: { de: visit.consultantId, para: consultantId, observacao: note || null },
    });
  });
}

// ─────────────── Cadastro manual (contingência) ───────────────

export const manualVisitSchema = z.object({
  requestId: z.string().min(8).max(100),
  scheduledStart: z.string(),
  durationMinutes: z.coerce.number().int().min(5).max(600).default(60),
  clientName: z.string().trim().min(1, "Informe o nome do cliente.").max(200),
  phoneRaw: z.string().trim().max(40).optional().default(""),
  propertyCode: z.string().trim().min(1, "Informe o código do imóvel.").max(40),
  consultantId: z.string().optional(),
});

export async function createManualVisit(actor: AuthzActor, input: z.input<typeof manualVisitSchema>) {
  const parsed = manualVisitSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("VALIDATION", "Revise os campos destacados.", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
  }
  const data = parsed.data;
  const settings = await getSettings();
  assert(canCreateManualVisit(actor, settings));
  const start = fromLocalInput(data.scheduledStart);
  if (!start) throw new AppError("VALIDATION", "Data/hora inválida.", { scheduledStart: "Data/hora inválida." });
  const consultantId = hasGlobalView(actor) ? data.consultantId : actor.id;
  if (!consultantId) throw new AppError("VALIDATION", "Selecione a consultora responsável.", { consultantId: "Obrigatório." });

  const existing = await db.visit.findUnique({ where: { createRequestId: data.requestId } });
  if (existing) {
    if (!canViewVisit(actor, existing)) throw notFound();
    return existing;
  }

  try {
    return await createManualVisitTx(actor, data, start, consultantId);
  } catch (e) {
    // corrida com a mesma chave de idempotência (duplo envio simultâneo)
    if ((e as { code?: string }).code === "P2002") {
      const again = await db.visit.findUnique({ where: { createRequestId: data.requestId } });
      if (again) return again;
    }
    throw e;
  }
}

async function createManualVisitTx(actor: AuthzActor, data: z.output<typeof manualVisitSchema>, start: Date, consultantId: string) {
  return db.$transaction(async (tx) => {
    const consultant = await tx.user.findUnique({ where: { id: consultantId } });
    if (!consultant || consultant.role !== "CONSULTANT" || !consultant.active) throw new AppError("VALIDATION", "Consultora inválida.");
    const phone = normalizePhone(data.phoneRaw);
    const link = await resolveClient(tx, { clientName: data.clientName, phoneRaw: data.phoneRaw || null });
    const visit = await tx.visit.create({
      data: {
        origin: "MANUAL",
        createRequestId: data.requestId,
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + data.durationMinutes * 60_000),
        clientName: data.clientName,
        phoneRaw: cleanOptional(data.phoneRaw),
        phoneNormalized: phone.normalized,
        propertyCode: data.propertyCode,
        propertyId: await ensureProperty(tx, data.propertyCode),
        consultantId,
        assignmentStatus: "MANUAL",
        assignmentNote: "CADASTRO_MANUAL",
        ...link,
      },
    });
    await audit(tx, { actorId: actor.id, action: "visit.created_manual", entityType: "Visit", entityId: visit.id });
    return visit;
  });
}

// ─────────────── Revisão (gestão) ───────────────

export async function setVisitExcluded(actor: AuthzActor, visitId: string, excluded: boolean, note: string) {
  assert(canReview(actor));
  if (!note.trim()) throw new AppError("VALIDATION", "Informe o motivo.");
  return db.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({ where: { id: visitId } });
    if (!visit) throw notFound();
    if (excluded) await detachVisitFromOpportunity(tx, visitId, actor.id);
    await tx.visit.update({
      where: { id: visitId },
      data: { excluded, syncConflict: excluded ? "NONE" : visit.syncConflict, version: { increment: 1 } },
    });
    if (!excluded) await applyDoneVisit(tx, visitId, actor.id);
    await audit(tx, { actorId: actor.id, action: excluded ? "visit.excluded" : "visit.included", entityType: "Visit", entityId: visitId, changes: { motivo: note.trim() } });
  });
}

export type ConflictAction = "KEEP" | "APPLY_GOOGLE" | "MARK_CANCELED" | "MERGE_RECREATION" | "SEPARATE";

/** Resolve conflito de sincronização sem apagar resultados silenciosamente. */
export async function resolveConflict(actor: AuthzActor, visitId: string, action: ConflictAction, note: string) {
  assert(canReview(actor));
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id = ${visitId} FOR UPDATE`;
    const visit = await tx.visit.findUnique({ where: { id: visitId } });
    if (!visit || visit.syncConflict === "NONE") throw notFound();
    const detail = (visit.conflictDetail ?? {}) as Record<string, unknown>;

    if (action === "MARK_CANCELED") {
      if (!note.trim()) throw new AppError("VALIDATION", "Informe uma observação.");
      await detachVisitFromOpportunity(tx, visitId, actor.id);
      await tx.visit.update({
        where: { id: visitId },
        data: { status: "CANCELED", evaluation: null, negativeReasonId: null, realizedById: null, note: note.trim(), concludedAt: new Date(), concludedById: actor.id, syncConflict: "NONE", conflictDetail: Prisma.DbNull, version: { increment: 1 } },
      });
      await tx.visitOutcomeHistory.create({ data: { visitId, status: "CANCELED", note: note.trim(), authorId: actor.id } });
    } else if (action === "APPLY_GOOGLE" && visit.syncConflict === "CHANGED_AFTER_CONCLUSION") {
      const google = (detail.google ?? {}) as Record<string, string | null>;
      const upd: Record<string, unknown> = { syncConflict: "NONE", conflictDetail: Prisma.DbNull, version: { increment: 1 } };
      if (google.scheduledStart) upd.scheduledStart = new Date(google.scheduledStart);
      if (google.scheduledEnd) upd.scheduledEnd = new Date(google.scheduledEnd);
      const identityChange = "clientName" in google || "phoneRaw" in google;
      const propertyChange = "propertyCode" in google;
      if (identityChange || propertyChange) await detachVisitFromOpportunity(tx, visitId, actor.id);
      if ("clientName" in google) upd.clientName = google.clientName;
      if ("phoneRaw" in google) {
        upd.phoneRaw = google.phoneRaw;
        upd.phoneNormalized = normalizePhone(google.phoneRaw).normalized;
      }
      if (propertyChange) {
        upd.propertyCode = google.propertyCode;
        upd.propertyId = await ensureProperty(tx, google.propertyCode);
      }
      if (identityChange && visit.clientMatch !== "CONFIRMED_MANUAL") {
        Object.assign(
          upd,
          await resolveClient(tx, {
            clientName: (upd.clientName as string | null | undefined) ?? visit.clientName,
            phoneRaw: "phoneRaw" in upd ? (upd.phoneRaw as string | null) : visit.phoneRaw,
            currentClientId: visit.clientId,
          }),
        );
      }
      await tx.visit.update({ where: { id: visitId }, data: upd });
      await applyDoneVisit(tx, visitId, actor.id);
    } else if (action === "MERGE_RECREATION" && visit.syncConflict === "POSSIBLE_RECREATION") {
      // visita nova (sem resultado) passa seu evento para a visita antiga, que mantém resultado e histórico
      const oldId = detail.candidateVisitId as string | undefined;
      const old = oldId ? await tx.visit.findUnique({ where: { id: oldId } }) : null;
      if (!old || visit.status !== "SCHEDULED") throw new AppError("INVALID_STATE", "Não é possível unir: a visita nova já tem resultado ou a anterior não existe.");
      const sourceEventId = visit.sourceEventId;
      await tx.visit.update({ where: { id: visitId }, data: { sourceEventId: null } });
      await tx.visit.update({
        where: { id: old.id },
        data: { sourceEventId, scheduledStart: visit.scheduledStart, scheduledEnd: visit.scheduledEnd, syncConflict: "NONE", conflictDetail: Prisma.DbNull, version: { increment: 1 } },
      });
      await tx.visitOutcomeHistory.deleteMany({ where: { visitId } });
      await tx.visit.delete({ where: { id: visitId } });
      await cleanupOrphanClient(tx, visit.clientId);
      await audit(tx, { actorId: actor.id, action: "visit.recreation_merged", entityType: "Visit", entityId: old.id, changes: { visitaRemovida: visitId, observacao: note || null } });
      return;
    } else {
      // KEEP / SEPARATE: mantém dados e resultado do app
      await tx.visit.update({ where: { id: visitId }, data: { syncConflict: "NONE", conflictDetail: Prisma.DbNull, version: { increment: 1 } } });
    }
    await audit(tx, { actorId: actor.id, action: "visit.conflict_resolved", entityType: "Visit", entityId: visitId, changes: { conflito: visit.syncConflict, acao: action, observacao: note || null } });
  });
}
