/**
 * Agenda Google dentro do app (pré-atendimento): espelho das agendas da conta conectada e das compartilhadas com ela.
 * Lida direto do Google a cada abertura (e a cada minuto com a tela aberta) — o conteúdo dos eventos que não são
 * visita não é guardado no banco. Tudo o que é feito aqui vai para o Google na hora.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assert, isAdmin, isPreService, type AuthzActor } from "@/lib/authz";
import { log } from "@/lib/log";
import { addDays, dayKey } from "@/lib/time";
import type { CalendarApi, GCalendar, GEvent } from "./sync/types";
import { authorizedClient, canEditEvents, realCalendarApi } from "./sync/google";
import { requestManualSync } from "./sync/runner";

/** Paleta de cores de evento do Google Agenda ("colorId"). */
export const EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "#0b8043",
  "11": "#d50000",
};

export const canUseMirror = (a: AuthzActor) => isPreService(a) || isAdmin(a);

export type MirrorCalendar = { id: string; name: string; color: string; primary: boolean; canWrite: boolean; visible: boolean };
export type MirrorVisit = { id: string; status: string; evaluation: string | null; confirmStatus: string | null; consultantId: string | null; consultant: string | null; codes: string[]; openCodes: string[]; cancelReason: string | null };
export type MirrorEvent = {
  key: string;
  calendarId: string;
  id: string;
  title: string;
  /** ISO; dia inteiro: início do dia */
  start: string;
  end: string;
  allDay: boolean;
  /** dia inteiro: primeiro dia e o dia seguinte ao último (YYYY-MM-DD) */
  startDay: string | null;
  endDay: string | null;
  color: string;
  location: string | null;
  description: string | null;
  organizer: string | null;
  attendees: { email: string; status: string | null }[];
  canEdit: boolean;
  recurring: boolean;
  declined: boolean;
  htmlLink: string | null;
  visit: MirrorVisit | null;
};
export type Mirror =
  | { status: "ok"; account: string; canWrite: boolean; calendars: MirrorCalendar[]; events: MirrorEvent[] }
  | { status: "no_connection" | "auth" | "error"; account: string | null; canWrite: false; calendars: []; events: [] };

async function connection(injected?: CalendarApi) {
  const conn = await db.googleConnection.findFirst({ where: { status: "CONNECTED" }, orderBy: { connectedAt: "desc" } });
  if (!conn) return null;
  const api = injected ?? realCalendarApi(await authorizedClient(conn.id));
  return { conn, api, canWrite: !!injected || canEditEvents(conn.scopes) };
}

const isOwn = (ev: GEvent, calendarId: string) => !ev.organizer?.email || ev.organizer.email.toLowerCase() === calendarId.toLowerCase();

/** Eventos de [from, to) de todas as agendas da conta (as próprias e as compartilhadas com ela). */
export async function loadMirror(actor: AuthzActor, from: Date, to: Date, opts: { calendarApi?: CalendarApi } = {}): Promise<Mirror> {
  assert(canUseMirror(actor));
  let c: Awaited<ReturnType<typeof connection>>;
  try {
    c = await connection(opts.calendarApi);
  } catch {
    return { status: "auth", account: null, canWrite: false, calendars: [], events: [] };
  }
  if (!c) return { status: "no_connection", account: null, canWrite: false, calendars: [], events: [] };
  const { conn, api, canWrite } = c;
  try {
    const list: GCalendar[] = (await api.listCalendars()).filter((x) => x.accessRole !== "none").slice(0, 25);
    const calendars: MirrorCalendar[] = list.map((x) => ({
      id: x.id,
      name: x.primary ? conn.googleEmail : x.summary,
      color: x.backgroundColor ?? "#039be5",
      primary: !!x.primary,
      canWrite: canWrite && (x.accessRole === "owner" || x.accessRole === "writer"),
      visible: x.selected !== false,
    }));
    const raw = await Promise.all(
      calendars.map(async (cal) => {
        const out: GEvent[] = [];
        let pageToken: string | undefined;
        for (let i = 0; i < 6; i++) {
          const page = await api.listEvents({ calendarId: cal.id, timeMin: from.toISOString(), timeMax: to.toISOString(), pageToken });
          out.push(...page.items);
          pageToken = page.nextPageToken ?? undefined;
          if (!pageToken) break;
        }
        return out.filter((e) => e.status !== "cancelled").map((e) => ({ cal, e }));
      }),
    );
    const flat = raw.flat();
    // visitas do app ligadas a estes eventos (situação, consultora, imóveis)
    const sources = await db.sourceEvent.findMany({
      where: { googleEventId: { in: [...new Set(flat.map((x) => x.e.id))] } },
      select: { calendarId: true, googleEventId: true, visit: { select: { id: true, status: true, evaluation: true, confirmStatus: true, propertyCode: true, consultantId: true, consultant: { select: { name: true } }, cancelReason: { select: { label: true } }, companions: { where: { excluded: false }, select: { propertyCode: true, status: true } } } } },
    });
    const visitOf = new Map(sources.map((s) => [s.googleEventId, s.visit]));
    const events: MirrorEvent[] = flat.map(({ cal, e }) => {
      const allDay = !!e.start?.date && !e.start?.dateTime;
      const startDay = allDay ? e.start!.date! : null;
      const endDay = allDay ? (e.end?.date ?? addDays(startDay!, 1)) : null;
      const start = allDay ? new Date(`${startDay}T03:00:00Z`) : new Date(e.start?.dateTime ?? Date.now());
      const end = allDay ? new Date(`${endDay}T03:00:00Z`) : new Date(e.end?.dateTime ?? start.getTime() + 3600_000);
      const v = visitOf.get(e.id);
      const self = (e.attendees ?? []).find((a) => a.self);
      const group = v ? [{ propertyCode: v.propertyCode, status: v.status }, ...v.companions] : [];
      return {
        key: `${cal.id}|${e.id}`,
        calendarId: cal.id,
        id: e.id,
        title: e.summary?.trim() || "(Sem título)",
        start: start.toISOString(),
        end: end.toISOString(),
        allDay,
        startDay,
        endDay,
        color: (e.colorId && EVENT_COLORS[e.colorId]) || cal.color,
        location: e.location ?? null,
        description: e.description ? e.description.slice(0, 1500) : null,
        organizer: e.organizer?.email ?? null,
        attendees: (e.attendees ?? []).filter((a) => a.email && !a.resource).slice(0, 30).map((a) => ({ email: a.email!, status: a.responseStatus ?? null })),
        canEdit: cal.canWrite && isOwn(e, cal.id),
        recurring: !!e.recurringEventId,
        declined: self?.responseStatus === "declined",
        htmlLink: e.htmlLink ?? null,
        visit: v
          ? {
              id: v.id,
              status: v.status,
              evaluation: v.evaluation,
              confirmStatus: v.confirmStatus,
              consultantId: v.consultantId,
              consultant: v.consultant?.name ?? null,
              codes: group.map((g) => g.propertyCode).filter((x): x is string => !!x),
              openCodes: group.filter((g) => g.status === "SCHEDULED").map((g) => g.propertyCode).filter((x): x is string => !!x),
              cancelReason: v.cancelReason?.label ?? null,
            }
          : null,
      };
    });
    return { status: "ok", account: conn.googleEmail, canWrite, calendars, events };
  } catch (e) {
    const kind = (e as { kind?: string }).kind;
    log.warn("calendar_mirror.load_failed", { kind: kind ?? "OTHER" });
    return { status: kind === "AUTH" ? "auth" : "error", account: conn.googleEmail, canWrite: false, calendars: [], events: [] };
  }
}

async function writable(actor: AuthzActor, calendarId: string, injected?: CalendarApi) {
  assert(canUseMirror(actor));
  const c = await connection(injected);
  if (!c) throw new AppError("INVALID_STATE", "A agenda Google não está conectada.");
  if (!c.canWrite) throw new AppError("INVALID_STATE", "O app ainda não tem permissão para editar a agenda Google.");
  const cal = (await c.api.listCalendars()).find((x) => x.id === calendarId);
  if (!cal || (cal.accessRole !== "owner" && cal.accessRole !== "writer")) throw new AppError("FORBIDDEN", "Você só pode ver esta agenda.");
  return c.api;
}

const googleFail = (e: unknown): never => {
  if (e instanceof AppError) throw e;
  log.warn("calendar_mirror.write_failed", { kind: (e as { kind?: string }).kind ?? "OTHER" });
  throw new AppError("INVALID_STATE", "Não consegui falar com a agenda Google agora. Tente de novo.");
};

/** Mudou de horário/dia (arrastar ou esticar). Visita: a sincronização atualiza o app em seguida. */
export async function moveMirrorEvent(actor: AuthzActor, input: { calendarId: string; eventId: string; start?: string; end?: string; startDay?: string; endDay?: string }, opts: { calendarApi?: CalendarApi } = {}) {
  const api = await writable(actor, input.calendarId, opts.calendarApi);
  const allDay = input.startDay && input.endDay && /^\d{4}-\d{2}-\d{2}$/.test(input.startDay) && /^\d{4}-\d{2}-\d{2}$/.test(input.endDay) ? { startDay: input.startDay, endDay: input.endDay } : null;
  const start = input.start ? new Date(input.start) : null;
  const end = input.end ? new Date(input.end) : null;
  if (!allDay && (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start)) throw new AppError("VALIDATION", "Horário inválido.");
  if (allDay && allDay.endDay <= allDay.startDay) throw new AppError("VALIDATION", "Dia inválido.");
  let r: "updated" | "not_owner" | "gone";
  try {
    r = await api.patchEvent(input.calendarId, input.eventId, allDay ? { allDay } : { start: start!, end: end! });
  } catch (e) {
    return googleFail(e);
  }
  if (r === "not_owner") throw new AppError("FORBIDDEN", "Este evento é de outra pessoa: só quem criou pode mudar o horário.");
  if (r === "gone") throw new AppError("NOT_FOUND", "O evento não existe mais na agenda Google.");
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "calendar.event_moved", entityType: "SourceEvent", entityId: input.eventId, changes: allDay ? { dia: allDay.startDay } : { inicio: start!.toISOString(), fim: end!.toISOString() } }));
  if (await db.sourceEvent.findFirst({ where: { googleEventId: input.eventId }, select: { id: true } })) await requestManualSync(actor.id).catch(() => undefined);
  return { ok: true as const };
}

/** Evento comum (não é visita): almoço, reunião, plantão… Visita é criada pelo formulário de visita. */
export async function createMirrorEvent(actor: AuthzActor, input: { calendarId: string; title: string; description?: string; start?: string; end?: string; startDay?: string; endDay?: string }, opts: { calendarApi?: CalendarApi } = {}) {
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new AppError("VALIDATION", "Dê um título ao evento.", { title: "Obrigatório." });
  const api = await writable(actor, input.calendarId, opts.calendarApi);
  const allDay = input.startDay && /^\d{4}-\d{2}-\d{2}$/.test(input.startDay) ? { startDay: input.startDay, endDay: input.endDay && input.endDay > input.startDay ? input.endDay : addDays(input.startDay, 1) } : null;
  const start = allDay ? new Date(`${allDay.startDay}T03:00:00Z`) : new Date(input.start ?? "");
  const end = allDay ? new Date(`${allDay.endDay}T03:00:00Z`) : new Date(input.end ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new AppError("VALIDATION", "Horário inválido.");
  let id: string;
  try {
    id = await api.insertEvent(input.calendarId, { summary: title, description: (input.description ?? "").slice(0, 4000), start, end, attendees: [], ...(allDay ? { allDay } : {}) });
  } catch (e) {
    return googleFail(e);
  }
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "calendar.event_created", entityType: "SourceEvent", entityId: id, changes: { dia: dayKey(start) } }));
  // se o título for de visita, a sincronização transforma em visita
  await requestManualSync(actor.id).catch(() => undefined);
  return { id };
}

/** Editar título/descrição de um evento comum. Visita: pela ficha da visita (o título segue o padrão). */
export async function editMirrorEvent(actor: AuthzActor, input: { calendarId: string; eventId: string; title: string; description?: string }, opts: { calendarApi?: CalendarApi } = {}) {
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new AppError("VALIDATION", "Dê um título ao evento.", { title: "Obrigatório." });
  if (await db.sourceEvent.findFirst({ where: { googleEventId: input.eventId, visit: { isNot: null } }, select: { id: true } })) throw new AppError("INVALID_STATE", "É uma visita: corrija pela ficha da visita.");
  const api = await writable(actor, input.calendarId, opts.calendarApi);
  let r: "updated" | "not_owner" | "gone";
  try {
    r = await api.patchEvent(input.calendarId, input.eventId, { summary: title, ...(input.description !== undefined ? { description: input.description.slice(0, 4000) } : {}) });
  } catch (e) {
    return googleFail(e);
  }
  if (r === "not_owner") throw new AppError("FORBIDDEN", "Este evento é de outra pessoa: só quem criou pode editar.");
  if (r === "gone") throw new AppError("NOT_FOUND", "O evento não existe mais na agenda Google.");
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "calendar.event_edited", entityType: "SourceEvent", entityId: input.eventId }));
  await requestManualSync(actor.id).catch(() => undefined);
  return { ok: true as const };
}

/** Excluir um evento comum. Visita: cancelar (com motivo) — o evento vai para as 22h. */
export async function deleteMirrorEvent(actor: AuthzActor, input: { calendarId: string; eventId: string }, opts: { calendarApi?: CalendarApi } = {}) {
  if (await db.sourceEvent.findFirst({ where: { googleEventId: input.eventId, visit: { isNot: null } }, select: { id: true } })) throw new AppError("INVALID_STATE", "É uma visita: use “Cancelar visita” (com o motivo).");
  const api = await writable(actor, input.calendarId, opts.calendarApi);
  let ev: GEvent | null;
  try {
    ev = await api.getEvent(input.calendarId, input.eventId);
  } catch (e) {
    return googleFail(e);
  }
  if (!ev || ev.status === "cancelled") return { ok: true as const };
  if (!isOwn(ev, input.calendarId)) throw new AppError("FORBIDDEN", "Este evento é de outra pessoa: só quem criou pode excluir.");
  try {
    await api.cancelEvent(input.calendarId, input.eventId);
  } catch (e) {
    return googleFail(e);
  }
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "calendar.event_deleted", entityType: "SourceEvent", entityId: input.eventId }));
  return { ok: true as const };
}
