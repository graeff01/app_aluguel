/**
 * O que muda no app vai para o mesmo evento da agenda Google (precisa da conexão com permissão de edição):
 * horário, imóveis/cliente no título e a consultora convidada. Evento organizado por outra pessoa (cópia de convidada)
 * não é alterado — a resposta "not_owner" diz para avisar quem é a dona do evento.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import type { CalendarApi } from "./sync/types";
import { authorizedClient, canEditEvents, realCalendarApi } from "./sync/google";
import { buildVisitEvent } from "./reschedule";

export type GoogleWrite = "updated" | "not_owner" | "gone" | "no_permission" | "not_in_agenda" | "error";

/** Evento da visita (o da visita principal, quando há vários imóveis) na agenda conectada, se dá para escrever. */
async function writable(visitId: string, injected?: CalendarApi) {
  const v = await db.visit.findUnique({ where: { id: visitId }, select: { id: true, companionOfId: true } });
  if (!v) return { reason: "not_in_agenda" as const };
  const primaryId = v.companionOfId ?? v.id;
  const primary = await db.visit.findUnique({ where: { id: primaryId }, include: { sourceEvent: { select: { calendarId: true, googleEventId: true } } } });
  const src = primary?.sourceEvent;
  if (!src) return { reason: "not_in_agenda" as const };
  const conn = await db.googleConnection.findFirst({ where: { status: "CONNECTED" }, orderBy: { connectedAt: "desc" } });
  if (!conn || conn.calendarId !== src.calendarId) return { reason: "not_in_agenda" as const };
  if (!injected && !canEditEvents(conn.scopes)) return { reason: "no_permission" as const };
  const api = injected ?? realCalendarApi(await authorizedClient(conn.id));
  return { reason: null, api, calendarId: src.calendarId, eventId: src.googleEventId, primaryId };
}

/** Dá para mudar o horário desta visita pelo app (o evento é da agenda conectada e há permissão)? Sem chamar o Google. */
export async function canEditInGoogle(visitId: string) {
  const v = await db.visit.findUnique({ where: { id: visitId }, select: { id: true, companionOfId: true } });
  if (!v) return false;
  const primary = await db.visit.findUnique({ where: { id: v.companionOfId ?? v.id }, select: { sourceEvent: { select: { calendarId: true } } } });
  const conn = await db.googleConnection.findFirst({ where: { status: "CONNECTED" }, orderBy: { connectedAt: "desc" } });
  return !!primary?.sourceEvent && !!conn && conn.calendarId === primary.sourceEvent.calendarId && canEditEvents(conn.scopes);
}

export async function pushVisitChange(visitId: string, what: { time?: boolean; title?: boolean; consultant?: { from: string | null; to: string } }, injected?: CalendarApi): Promise<GoogleWrite> {
  try {
    const w = await writable(visitId, injected);
    if (w.reason) return w.reason;
    const ev = await buildVisitEvent(w.primaryId);
    const patch: Parameters<CalendarApi["patchEvent"]>[2] = {};
    if (what.time) Object.assign(patch, { start: ev.v.scheduledStart, end: ev.v.scheduledEnd });
    if (what.title) Object.assign(patch, { summary: ev.title, ...(ev.location ? { location: ev.location } : {}) });
    if (what.consultant) {
      const emails = async (id: string | null) => (id ? (await db.userEmailAlias.findMany({ where: { userId: id }, select: { email: true } })).map((a) => a.email) : []);
      patch.swapAttendees = { remove: await emails(what.consultant.from), add: (await emails(what.consultant.to)).slice(0, 1) };
    }
    if (Object.keys(patch).length === 0) return "updated";
    const r = await w.api.patchEvent(w.calendarId, w.eventId, patch);
    await db.$transaction((tx) => audit(tx, { actorId: null, action: "google.event_updated", entityType: "Visit", entityId: w.primaryId, changes: { campos: Object.keys(patch), resultado: r } }));
    return r;
  } catch (e) {
    log.warn("google.patch_failed", { kind: (e as { kind?: string }).kind ?? "OTHER" });
    return "error";
  }
}

/** Remarcação: o evento antigo sai da agenda (a nova visita tem o seu próprio evento). */
export async function cancelOldEvent(visitId: string, injected?: CalendarApi): Promise<"canceled" | "removed" | "already" | "no_permission" | "not_in_agenda" | "error"> {
  try {
    const w = await writable(visitId, injected);
    if (w.reason) return w.reason;
    const r = await w.api.cancelEvent(w.calendarId, w.eventId);
    await db.$transaction((tx) => audit(tx, { actorId: null, action: "google.old_event_canceled", entityType: "Visit", entityId: w.primaryId, changes: { resultado: r } }));
    return r;
  } catch (e) {
    log.warn("google.cancel_old_failed", { kind: (e as { kind?: string }).kind ?? "OTHER" });
    return "error";
  }
}
