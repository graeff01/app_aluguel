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
  isPreService,
  type AuthzActor,
} from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { normalizePhone } from "@/lib/phone";
import { cleanOptional, normalizeText } from "@/lib/text";
import { notifyUser } from "./notify";
import { log } from "@/lib/log";
import { removeCodeFromTitle } from "@/lib/parser";
import type { CalendarApi } from "./sync/types";
import { authorizedClient, canEditEvents, realCalendarApi } from "./sync/google";
import { canEditInGoogle, pushVisitChange } from "./google-write";
import { addDays, dateOnlyFromKey, dayKey, fromLocalInput, startOfDayInTz } from "@/lib/time";
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
    /** "ainda decidindo": daqui a quantos dias ligar de volta (null = sem data) */
    followUpDays: z.number().int().min(0).max(60).nullable().optional(),
    /** visita com vários imóveis: "não compareceu"/"cancelada"/"remarcada" vale também para os outros imóveis em aberto */
    applyToSameVisit: z.boolean().optional(),
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
        // retorno do "ainda decidindo" (outro resultado limpa)
        ...(data.status === "DONE" && data.evaluation === "UNDECIDED"
          ? data.followUpDays != null
            ? { followUpOn: dateOnlyFromKey(addDays(dayKey(now), data.followUpDays)), followUpDoneAt: null }
            : {}
          : { followUpOn: null, followUpDoneAt: null }),
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
    if (data.applyToSameVisit && data.status !== "DONE") await concludeSameVisit(tx, actor, visit, data.status, note, data.requestId, now);
    const fresh = await tx.visit.findUniqueOrThrow({ where: { id: visit.id } });
    return { visit: fresh, idempotent: false as const };
  });
}

/** Outras visitas do mesmo evento (vários imóveis), na ordem dos códigos. */
export async function sameVisitGroup(tx: Tx, v: { id: string; companionOfId: string | null }) {
  const groupId = v.companionOfId ?? v.id;
  return tx.visit.findMany({ where: { excluded: false, id: { not: v.id }, OR: [{ id: groupId }, { companionOfId: groupId }] }, orderBy: { createdAt: "asc" } });
}

/** Cliente não veio / cancelou / remarcou: o mesmo status vale para os outros imóveis ainda em aberto da mesma visita. */
export async function concludeSameVisit(tx: Tx, actor: AuthzActor, v: { id: string; companionOfId: string | null }, status: "NO_SHOW" | "CANCELED" | "RESCHEDULED", note: string, requestId: string, now: Date) {
  for (const s of await sameVisitGroup(tx, v)) {
    if (s.status !== "SCHEDULED" || !canConcludeVisit(actor, s)) continue;
    await detachVisitFromOpportunity(tx, s.id, actor.id);
    await tx.visit.update({
      where: { id: s.id },
      data: { status, evaluation: null, negativeReasonId: null, note, concludedAt: now, concludedById: actor.id, realizedById: null, autoCanceled: false, followUpOn: null, followUpDoneAt: null, version: { increment: 1 }, lastRequestId: `${requestId}:${s.id}`.slice(0, 100) },
    });
    await tx.visitOutcomeHistory.create({ data: { visitId: s.id, status, note, authorId: actor.id } });
    await audit(tx, { actorId: actor.id, action: "visit.concluded", entityType: "Visit", entityId: s.id, changes: { status: { from: "SCHEDULED", to: status }, mesmaVisita: v.id } });
  }
}

/**
 * Pré-atendimento (ou gestão) cancela a visita com motivo da lista. Vale para todos os imóveis em aberto
 * da mesma visita; a consultora é avisada no celular.
 */
export type GoogleCancel = "moved" | "move_not_owner" | "canceled" | "removed" | "code_removed" | "not_owner" | "already" | "no_permission" | "not_in_agenda" | "error";

export async function cancelVisitByStaff(
  actor: AuthzActor,
  visitId: string,
  input: { reasonId: string; note?: string; onlyThis?: boolean; /** o que estava na tela ao confirmar: imóvel e os outros imóveis da visita */ seen?: { code: string; others: string[] } },
  now = new Date(),
  opts: { calendarApi?: CalendarApi } = {},
) {
  assert(isPreService(actor) || hasGlobalView(actor));
  const reason = await db.reason.findUnique({ where: { id: input.reasonId } });
  if (!reason || reason.kind !== "VISIT_CANCEL" || !reason.active) throw new AppError("VALIDATION", "Escolha o motivo do cancelamento.", { reasonId: "Escolha o motivo." });
  const extra = (input.note ?? "").trim().slice(0, 500);
  if (normalizeText(reason.label) === "outro" && !extra) throw new AppError("VALIDATION", "Descreva o motivo.", { note: "Obrigatório quando o motivo é Outro." });
  const note = extra ? `${reason.label} — ${extra}` : reason.label;
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id = ${visitId} FOR UPDATE`;
    const visit = await tx.visit.findUnique({ where: { id: visitId }, include: { sourceEvent: { select: { calendarId: true, googleEventId: true, organizerEmail: true } } } });
    if (!visit || visit.excluded) throw notFound();
    if (visit.status !== "SCHEDULED") throw new AppError("INVALID_STATE", "Esta visita já tem resultado registrado.");
    const openSiblings = (await sameVisitGroup(tx, visit)).filter((s) => s.status === "SCHEDULED");
    // a agenda pode ter mudado a visita enquanto a tela estava aberta (ex.: troca de imóvel no título):
    // nunca cancela um imóvel diferente do que a pessoa viu
    if (input.seen) {
      const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
      if ((visit.propertyCode ?? "") !== input.seen.code || !same(openSiblings.map((s) => s.propertyCode ?? ""), input.seen.others)) {
        throw new AppError("CONFLICT", `Esta visita mudou na agenda enquanto a tela estava aberta (agora: imóvel ${[visit.propertyCode, ...openSiblings.map((s) => s.propertyCode)].filter(Boolean).join(", ") || "sem código"}). Confira e cancele de novo.`);
      }
    }
    // vários imóveis: cancelar só este (o cliente desistiu de um) ou todos
    const ids = input.onlyThis ? [visit.id] : [visit.id, ...openSiblings.map((s) => s.id)];
    const cancelledCodes = (input.onlyThis ? [visit] : [visit, ...openSiblings]).map((v) => v.propertyCode).filter((c): c is string => !!c);
    const remaining = input.onlyThis ? openSiblings.length : 0;
    // o evento da agenda é o da visita principal
    const groupId = visit.companionOfId ?? visit.id;
    const source = groupId === visit.id ? visit.sourceEvent : (await tx.visit.findUnique({ where: { id: groupId }, include: { sourceEvent: { select: { calendarId: true, googleEventId: true, organizerEmail: true } } } }))?.sourceEvent ?? null;
    for (const id of ids) {
      await detachVisitFromOpportunity(tx, id, actor.id);
      await tx.visit.update({
        where: { id },
        data: { status: "CANCELED", cancelReasonId: reason.id, note, evaluation: null, negativeReasonId: null, concludedAt: now, concludedById: actor.id, realizedById: null, autoCanceled: false, followUpOn: null, followUpDoneAt: null, version: { increment: 1 } },
      });
      await tx.visitOutcomeHistory.create({ data: { visitId: id, status: "CANCELED", note, authorId: actor.id } });
      await audit(tx, { actorId: actor.id, action: "visit.canceled_by_staff", entityType: "Visit", entityId: id, changes: { motivo: reason.label } });
    }
    return { visit, ids, count: ids.length, source, remaining, cancelledCodes };
  });
  // agenda Google (um evento só, mesmo com vários imóveis): o evento NÃO é apagado — vai para as 22h do mesmo dia,
  // como o pré-atendimento faz à mão (as consultoras veem o que caiu). Só um imóvel: tira o código do título.
  // Falha no Google não desfaz o app.
  const titles: { before?: string; after?: string } = {};
  const times = { start: result.visit.scheduledStart, end: result.visit.scheduledEnd };
  const google = result.remaining > 0 ? await removeCodesInGoogle(result.source, result.cancelledCodes, opts.calendarApi, titles) : await moveToNightInGoogle(result.source, times, opts.calendarApi);
  // guarda o que mudou para o "Desfazer"
  const undo = await db.visitCancelUndo.create({
    data: {
      actorId: actor.id,
      visitIds: result.ids,
      calendarId: result.source?.calendarId ?? null,
      googleEventId: result.source?.googleEventId ?? null,
      googleAction: google === "moved" || google === "code_removed" ? google : null,
      previousSummary: titles.before ?? null,
      newSummary: titles.after ?? null,
      previousStart: google === "moved" ? times.start : null,
      previousEnd: google === "moved" ? times.end : null,
      createdAt: now,
    },
  });
  if (result.visit.consultantId && result.visit.consultantId !== actor.id) {
    const when = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(result.visit.scheduledStart);
    const tail = google === "removed" ? " Apague o evento na sua agenda Google." : google === "not_owner" ? ` Tire o imóvel ${result.cancelledCodes.join(", ")} do título do evento na sua agenda Google.` : "";
    await notifyUser(result.visit.consultantId, { title: `Visita de ${when} cancelada`, body: `Motivo: ${reason.label}${result.visit.propertyCode ? ` · imóvel ${result.visit.propertyCode}` : ""}.${tail}`, url: `/visitas/${result.visit.id}`, tag: `cancelada-${result.visit.id}` }).catch(() => undefined);
  }
  return { count: result.count, google, undoId: undo.id };
}

/**
 * Visita já cancelada sem motivo da lista (a consultora marcou "cancelou" ou a agenda Google cancelou):
 * o pré-atendimento/gestão informa o motivo. Vale também para os outros imóveis cancelados no mesmo momento.
 */
export async function setCancelReason(actor: AuthzActor, visitId: string, input: { reasonId: string; note?: string }) {
  assert(isPreService(actor) || hasGlobalView(actor));
  const reason = await db.reason.findUnique({ where: { id: input.reasonId } });
  if (!reason || reason.kind !== "VISIT_CANCEL" || !reason.active) throw new AppError("VALIDATION", "Escolha o motivo do cancelamento.", { reasonId: "Escolha o motivo." });
  const extra = (input.note ?? "").trim().slice(0, 500);
  if (normalizeText(reason.label) === "outro" && !extra) throw new AppError("VALIDATION", "Descreva o motivo.", { note: "Obrigatório quando o motivo é Outro." });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id = ${visitId} FOR UPDATE`;
    const visit = await tx.visit.findUnique({ where: { id: visitId } });
    if (!visit || visit.excluded) throw notFound();
    if (visit.status !== "CANCELED") throw new AppError("INVALID_STATE", "Esta visita não está cancelada.");
    if (visit.cancelReasonId) throw new AppError("INVALID_STATE", "Esta visita já tem motivo de cancelamento.");
    const same = (await sameVisitGroup(tx, visit)).filter((s) => s.status === "CANCELED" && !s.cancelReasonId && s.concludedAt?.getTime() === visit.concludedAt?.getTime());
    for (const v of [visit, ...same]) {
      // mantém o que já estava escrito (ex.: "Cliente cancelou a visita.")
      const note = [reason.label, extra, v.note && v.note !== reason.label ? v.note : ""].filter(Boolean).join(" — ").slice(0, 1000);
      await tx.visit.update({ where: { id: v.id }, data: { cancelReasonId: reason.id, note, version: { increment: 1 } } });
      await tx.visitOutcomeHistory.create({ data: { visitId: v.id, status: "CANCELED", note: `Motivo informado: ${note}`, authorId: actor.id } });
      await audit(tx, { actorId: actor.id, action: "visit.cancel_reason_set", entityType: "Visit", entityId: v.id, changes: { motivo: reason.label } });
    }
    return { count: same.length + 1 };
  });
}

/** Janela para desfazer um cancelamento do pré-atendimento. */
export const CANCEL_UNDO_MS = 2 * 60_000;

/**
 * Desfaz o cancelamento (clique errado): as visitas voltam a agendadas e, no Google, o evento é reaberto
 * ou o título volta a ter o código — só se ninguém mexeu no título depois.
 */
export async function undoStaffCancel(actor: AuthzActor, undoId: string, now = new Date(), opts: { calendarApi?: CalendarApi } = {}) {
  assert(isPreService(actor) || hasGlobalView(actor));
  const u = await db.visitCancelUndo.findUnique({ where: { id: undoId } });
  if (!u || (u.actorId !== actor.id && !hasGlobalView(actor))) throw notFound();
  if (u.undoneAt) throw new AppError("INVALID_STATE", "Este cancelamento já foi desfeito.");
  if (now.getTime() - u.createdAt.getTime() > CANCEL_UNDO_MS) throw new AppError("INVALID_STATE", "Passou o tempo para desfazer. Peça à gestão para corrigir a visita.");
  const restored = await db.$transaction(async (tx) => {
    const claimed = await tx.visitCancelUndo.updateMany({ where: { id: u.id, undoneAt: null }, data: { undoneAt: now } });
    if (claimed.count === 0) throw new AppError("INVALID_STATE", "Este cancelamento já foi desfeito.");
    const visits = await tx.visit.findMany({ where: { id: { in: u.visitIds } } });
    const back = visits.filter((v) => v.status === "CANCELED" && v.cancelReasonId && v.concludedById === u.actorId);
    for (const v of back) {
      await tx.visit.update({ where: { id: v.id }, data: { status: "SCHEDULED", cancelReasonId: null, note: null, concludedAt: null, concludedById: null, version: { increment: 1 } } });
      await tx.visitOutcomeHistory.create({ data: { visitId: v.id, status: "SCHEDULED", note: "Cancelamento desfeito", authorId: actor.id } });
      await audit(tx, { actorId: actor.id, action: "visit.cancel_undone", entityType: "Visit", entityId: v.id });
    }
    return back;
  });
  // Google: volta o que o app mudou
  let google: "restored" | "time_back" | "title_back" | "title_changed" | "none" | "error" = "none";
  if (u.googleAction && u.calendarId && u.googleEventId) {
    try {
      const conn = await db.googleConnection.findFirst({ where: { status: "CONNECTED" }, orderBy: { connectedAt: "desc" } });
      const api = opts.calendarApi ?? (conn && conn.calendarId === u.calendarId && canEditEvents(conn.scopes) ? realCalendarApi(await authorizedClient(conn.id)) : null);
      if (api && u.googleAction === "moved" && u.previousStart && u.previousEnd) {
        google = (await api.patchEvent(u.calendarId, u.googleEventId, { start: u.previousStart, end: u.previousEnd })) === "updated" ? "time_back" : "error";
      } else if (api && (u.googleAction === "canceled" || u.googleAction === "removed")) {
        google = (await api.restoreEvent(u.calendarId, u.googleEventId)) === "restored" ? "restored" : "error";
      } else if (api && u.googleAction === "code_removed" && u.previousSummary) {
        let changed = false;
        await api.updateSummary(u.calendarId, u.googleEventId, (current) => {
          if (current !== u.newSummary) {
            changed = true; // alguém editou depois: não sobrescreve
            return current;
          }
          return u.previousSummary!;
        });
        google = changed ? "title_changed" : "title_back";
      }
    } catch (e) {
      log.warn("google.undo_failed", { kind: (e as { kind?: string }).kind ?? "OTHER" });
      google = "error";
    }
  }
  const first = restored[0];
  if (first?.consultantId && first.consultantId !== actor.id) {
    const when = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(first.scheduledStart);
    await notifyUser(first.consultantId, { title: `Visita de ${when} voltou a valer`, body: "O cancelamento foi desfeito pelo pré-atendimento.", url: `/visitas/${first.id}`, tag: `cancelada-${first.id}` }).catch(() => undefined);
  }
  return { count: restored.length, google };
}

/**
 * Reabrir visita cancelada no app (depois do "Desfazer" de 2 minutos): gestão ou pré-atendimento, com o motivo.
 * Volta a agendada e, na agenda Google, o evento volta ao horário da visita com o imóvel no título.
 * Cancelamento pela própria agenda (evento apagado ou movido para a noite) se desfaz na agenda, não aqui.
 */
export async function reopenCanceledVisit(actor: AuthzActor, visitId: string, input: { note: string }, now = new Date(), opts: { calendarApi?: CalendarApi } = {}) {
  assert(isPreService(actor) || hasGlobalView(actor));
  const why = input.note.trim().slice(0, 300);
  if (why.length < 3) throw new AppError("VALIDATION", "Conte por que a visita está sendo reaberta.", { note: "Obrigatório." });
  const v = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id = ${visitId} FOR UPDATE`;
    const visit = await tx.visit.findUnique({ where: { id: visitId } });
    if (!visit || visit.excluded) throw notFound();
    if (visit.status !== "CANCELED") throw new AppError("INVALID_STATE", "Esta visita não está cancelada.");
    if (visit.autoCanceled) throw new AppError("INVALID_STATE", "Esta visita foi cancelada pela agenda Google: volte o evento ao horário normal na agenda e ela reabre sozinha.");
    const note = `Reaberta por ${(await tx.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name.split(" ")[0] ?? "a equipe"}: ${why}`;
    await tx.visit.update({
      where: { id: visitId },
      data: { status: "SCHEDULED", cancelReasonId: null, note: null, concludedAt: null, concludedById: null, version: { increment: 1 } },
    });
    await tx.visitOutcomeHistory.create({ data: { visitId, status: "SCHEDULED", note, authorId: actor.id } });
    await audit(tx, { actorId: actor.id, action: "visit.reopened", entityType: "Visit", entityId: visitId, changes: { motivo: why, canceladaEm: visit.concludedAt?.toISOString() ?? null } });
    return visit;
  });
  // agenda Google: horário da visita e todos os imóveis em aberto no título
  const google = await pushVisitChange(visitId, { time: true, title: true }, opts.calendarApi);
  if (v.consultantId && v.consultantId !== actor.id) {
    const when = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(v.scheduledStart);
    await notifyUser(v.consultantId, { title: `Visita de ${when} reaberta`, body: `${v.propertyCode ? `Imóvel ${v.propertyCode}. ` : ""}O cancelamento foi desfeito. Toque para ver.`, url: `/visitas/${v.id}`, tag: `reaberta-${v.id}` }).catch(() => undefined);
  }
  return { google };
}

/** Outros imóveis continuam: tira só o(s) código(s) cancelado(s) do título do evento. */
async function removeCodesInGoogle(source: { calendarId: string; googleEventId: string } | null, codes: string[], injected?: CalendarApi, titles: { before?: string; after?: string } = {}): Promise<GoogleCancel> {
  if (!source || !codes.length) return "not_in_agenda";
  const conn = await db.googleConnection.findFirst({ where: { status: "CONNECTED" }, orderBy: { connectedAt: "desc" } });
  if (!conn || conn.calendarId !== source.calendarId) return "not_in_agenda";
  if (!injected && !canEditEvents(conn.scopes)) return "no_permission";
  try {
    const api = injected ?? realCalendarApi(await authorizedClient(conn.id));
    const r = await api.updateSummary(source.calendarId, source.googleEventId, (title) => {
      titles.before = title;
      titles.after = codes.reduce((t, c) => removeCodeFromTitle(t, c), title);
      return titles.after;
    });
    await db.$transaction((tx) => audit(tx, { actorId: null, action: "google.event_codes_removed", entityType: "SourceEvent", entityId: source.googleEventId, changes: { codigos: codes, resultado: r } }));
    return r === "updated" ? "code_removed" : r === "not_owner" ? "not_owner" : "already";
  } catch (e) {
    const err = e as { kind?: string };
    log.warn("google.update_failed", { kind: err.kind ?? "OTHER" });
    return err.kind === "PERMISSION" ? "no_permission" : "error";
  }
}

/** Hora para onde o evento cancelado vai na agenda (o mesmo dia, 22h): continua visível e a sincronização entende como cancelada. */
const NIGHT_HOUR = 22;

async function moveToNightInGoogle(source: { calendarId: string; googleEventId: string } | null, times: { start: Date; end: Date }, injected?: CalendarApi): Promise<GoogleCancel> {
  if (!source) return "not_in_agenda";
  const conn = await db.googleConnection.findFirst({ where: { status: "CONNECTED" }, orderBy: { connectedAt: "desc" } });
  if (!conn || conn.calendarId !== source.calendarId) return "not_in_agenda";
  if (!injected && !canEditEvents(conn.scopes)) return "no_permission";
  const start = new Date(startOfDayInTz(dayKey(times.start)).getTime() + NIGHT_HOUR * 3600_000);
  if (times.start >= start) return "already"; // já está às 22h ou depois
  const end = new Date(start.getTime() + Math.max(15 * 60_000, times.end.getTime() - times.start.getTime()));
  try {
    const api = injected ?? realCalendarApi(await authorizedClient(conn.id));
    const r = await api.patchEvent(source.calendarId, source.googleEventId, { start, end });
    await db.$transaction((tx) => audit(tx, { actorId: null, action: "google.event_moved_to_night", entityType: "SourceEvent", entityId: source.googleEventId, changes: { resultado: r, para: start.toISOString() } }));
    return r === "updated" ? "moved" : r === "not_owner" ? "move_not_owner" : "already";
  } catch (e) {
    const err = e as { kind?: string };
    log.warn("google.move_failed", { kind: err.kind ?? "OTHER" });
    return err.kind === "PERMISSION" ? "no_permission" : "error";
  }
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

export async function correctVisitData(actor: AuthzActor, visitId: string, input: z.input<typeof correctionSchema>, opts: { calendarApi?: CalendarApi } = {}) {
  const data = correctionSchema.parse(input);
  const settings = await getSettings();
  // visita da agenda: o horário pode mudar pelo app quando o app consegue mudar o mesmo evento no Google
  const googleEditable = (data.scheduledStart || data.scheduledEnd) && (opts.calendarApi ? true : await canEditInGoogle(visitId));
  const before = await db.visit.findUnique({ where: { id: visitId }, select: { scheduledStart: true, scheduledEnd: true, origin: true, sourceEventId: true, companionOfId: true, clientName: true, phoneRaw: true, propertyCode: true } });
  const result = await db.$transaction(async (tx) => {
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
      if (visit.origin !== "MANUAL" && !googleEditable) throw new AppError("VALIDATION", "O horário de visitas importadas vem da agenda Google. Corrija o evento na agenda.");
      if (visit.companionOfId) throw new AppError("VALIDATION", "Os imóveis desta visita são no mesmo horário: mude o horário na visita principal.", { scheduledStart: "Mude na visita principal." });
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
  // leva a correção para o mesmo evento na agenda Google
  const changed = result && before && (result.scheduledStart.getTime() !== before.scheduledStart.getTime() || result.scheduledEnd.getTime() !== before.scheduledEnd.getTime());
  const titleFields = !!result && !!before && (result.clientName !== before.clientName || result.phoneRaw !== before.phoneRaw || result.propertyCode !== before.propertyCode);
  if (result && (changed || titleFields)) {
    const g = await pushVisitChange(visitId, { time: !!changed, title: titleFields }, opts.calendarApi);
    if (changed && before && before.origin !== "MANUAL" && g !== "updated") {
      // não ficou igual no Google: volta o horário (senão a sincronização desfaria sozinha)
      await db.visit.update({ where: { id: visitId }, data: { scheduledStart: before.scheduledStart, scheduledEnd: before.scheduledEnd } });
      throw new AppError("INVALID_STATE", g === "not_owner" ? "O evento é da consultora: mude o horário na agenda dela." : "Não consegui mudar o horário no Google agora. Tente de novo ou mude na agenda.");
    }
    return Object.assign(result, { google: g });
  }
  return result;
}

// ─────────────── Atribuição ───────────────

export async function assignVisit(actor: AuthzActor, visitId: string, consultantId: string, note: string, opts: { calendarApi?: CalendarApi } = {}) {
  assert(canAssignVisit(actor));
  const previous = await assignVisitInDb(actor, visitId, consultantId, note);
  // a nova consultora entra como convidada no evento (e a anterior sai)
  if (previous !== consultantId) return pushVisitChange(visitId, { consultant: { from: previous, to: consultantId } }, opts.calendarApi);
  return "updated" as const;
}

async function assignVisitInDb(actor: AuthzActor, visitId: string, consultantId: string, note: string) {
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
    return visit.consultantId;
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
        scheduledById: actor.id,
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

// ─────────────── Desfazer (janela curta após o primeiro registro) ───────────────

export const UNDO_WINDOW_MS = 20_000; // a interface oferece 5 s; folga para latência de rede

/**
 * Desfaz o PRIMEIRO registro de resultado feito pela própria pessoa, logo após salvar.
 * Volta a visita para "agendada" (pendente), remove o vínculo com a oportunidade e registra auditoria.
 */
export async function undoConclusion(actor: AuthzActor, visitId: string, requestId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id = ${visitId} FOR UPDATE`;
    const visit = await tx.visit.findUnique({ where: { id: visitId } });
    if (!visit || !canViewVisit(actor, visit)) throw notFound();
    const history = await tx.visitOutcomeHistory.findMany({ where: { visitId }, orderBy: { createdAt: "desc" } });
    const expired = !visit.concludedAt || now.getTime() - visit.concludedAt.getTime() > UNDO_WINDOW_MS;
    if (visit.lastRequestId !== requestId || visit.concludedById !== actor.id || history.length !== 1 || expired) {
      throw new AppError("INVALID_STATE", "Não é mais possível desfazer. Use “Alterar resultado” se precisar corrigir.");
    }
    await detachVisitFromOpportunity(tx, visit.id, actor.id);
    await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: "SCHEDULED",
        evaluation: null,
        negativeReasonId: null,
        note: null,
        concludedAt: null,
        concludedById: null,
        realizedById: null,
        lastRequestId: null,
        version: { increment: 1 },
      },
    });
    await tx.visitOutcomeHistory.deleteMany({ where: { visitId } });
    await audit(tx, { actorId: actor.id, action: "visit.undone", entityType: "Visit", entityId: visit.id, changes: { desfeito: { status: visit.status, evaluation: visit.evaluation } } });
    return tx.visit.findUniqueOrThrow({ where: { id: visit.id } });
  });
}
