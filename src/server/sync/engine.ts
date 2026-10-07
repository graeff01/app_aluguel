/**
 * Motor de sincronização (Google → espelho SourceEvent → Visit).
 *
 * Estratégia:
 * 1. Sincronização completa da janela [hoje − passado, hoje + futuro] com singleEvents=true e showDeleted=true;
 *    guarda nextSyncToken.
 * 2. Execuções seguintes: incremental com syncToken (sem timeMin/timeMax, conforme restrição oficial).
 *    Mudanças fora da janela são ignoradas, exceto de eventos já conhecidos.
 * 3. Expansão explícita da janela: quando hoje+futuro passa do fim da janela, lista o trecho novo (sem token) e
 *    atualiza windowEnd — futuras visitas nunca ficam fora da janela importada.
 * 4. Reconciliação diária: nova sincronização completa + verificação individual (events.get) de eventos conhecidos
 *    que sumiram da listagem.
 * 5. Token inválido (410) → reconstrução do espelho por sincronização completa. Resultados de negócio nunca são apagados.
 *
 * Idempotência: chave (calendarId, id da ocorrência). Recorrências usam o id da instância, nunca só o iCalUID.
 */
import { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { log } from "@/lib/log";
import { assignConsultant, classifyTitle, parseVisitEvent, type PatternConfig } from "@/lib/parser";
import { getPatternConfig, getSettings } from "@/lib/settings";
import { normalizeEmail } from "@/lib/text";
import { audit } from "@/lib/audit";
import { resolveClient, cleanupOrphanClient } from "../clients";
import { ensureProperty } from "../visits";
import { htmlToText } from "./sanitize";
import { DETAIL_ROLES, GoogleApiError, type CalendarApi, type GEvent } from "./types";

const DAY = 86400_000;
const RECONCILE_EVERY_MS = DAY;

export type SyncStats = {
  mode: "full" | "incremental";
  pages: number;
  received: number;
  visits: number;
  ambiguous: number;
  ignored: number;
  created: number;
  updated: number;
  canceled: number;
  conflicts: number;
  windowExtended: boolean;
  reconciled: number;
};

export type SyncContext = {
  api: CalendarApi;
  now?: Date;
  /** força sincronização completa */
  full?: boolean;
  sleep?: (ms: number) => Promise<void>;
};

type Ctx = {
  api: CalendarApi;
  now: Date;
  calendarId: string;
  patterns: PatternConfig;
  aliases: Map<string, string>;
  stats: SyncStats;
  sleep: (ms: number) => Promise<void>;
  seen: Set<string>;
};

/** Retries limitados com backoff exponencial + jitter para falhas temporárias. */
export async function withRetry<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!(e instanceof GoogleApiError) || e.kind !== "RETRYABLE" || i === attempts - 1) throw e;
      const base = e.retryAfterMs ?? 1000 * 2 ** i;
      await sleep(Math.min(base + Math.floor(Math.random() * 250), 30_000));
    }
  }
  throw last;
}

function eventTimes(ev: GEvent) {
  const allDay = !ev.start?.dateTime && !!ev.start?.date;
  const parse = (t?: { dateTime?: string | null; date?: string | null } | null) => {
    if (!t) return null;
    if (t.dateTime) return new Date(t.dateTime);
    if (t.date) return new Date(t.date + "T03:00:00.000Z"); // 00:00 em São Paulo
    return null;
  };
  const start = parse(ev.start);
  const end = parse(ev.end) ?? start;
  const originalStart = parse(ev.originalStartTime);
  return { start, end, allDay, originalStart };
}

async function loadAliases(): Promise<Map<string, string>> {
  const rows = await db.userEmailAlias.findMany({
    where: { user: { role: "CONSULTANT", active: true } },
    select: { email: true, userId: true },
  });
  return new Map(rows.map((r) => [normalizeEmail(r.email), r.userId]));
}

/** Processa um evento recebido do Google (idempotente). */
async function processEvent(ctx: Ctx, ev: GEvent, opts: { inWindowOnly: boolean; windowStart?: Date | null; windowEnd?: Date | null }) {
  ctx.stats.received++;
  ctx.seen.add(ev.id);
  const key = { calendarId_googleEventId: { calendarId: ctx.calendarId, googleEventId: ev.id } };
  const existing = await db.sourceEvent.findUnique({ where: key, include: { visit: true } });

  if (ev.status === "cancelled") {
    if (!existing) {
      ctx.stats.ignored++;
      return;
    }
    await db.$transaction(async (tx) => {
      await tx.sourceEvent.update({ where: { id: existing.id }, data: { googleStatus: "cancelled", lastSeenAt: ctx.now, googleUpdatedAt: ev.updated ? new Date(ev.updated) : undefined } });
      if (existing.visit) await handleCancellation(tx, existing.visit.id, ctx);
    });
    return;
  }

  const { start, end, allDay, originalStart } = eventTimes(ev);
  if (opts.inWindowOnly && !existing && start && opts.windowStart && opts.windowEnd) {
    if (start < opts.windowStart || start >= opts.windowEnd) {
      ctx.stats.ignored++;
      return;
    }
  }

  const classification = classifyTitle(ev.summary, ctx.patterns);
  const base = {
    googleStatus: ev.status ?? "confirmed",
    googleUpdatedAt: ev.updated ? new Date(ev.updated) : null,
    etag: ev.etag ?? null,
    recurringEventId: ev.recurringEventId ?? null,
    iCalUID: ev.iCalUID ?? null,
    originalStartTime: originalStart,
    startAt: start,
    endAt: end,
    allDay,
    lastSeenAt: ctx.now,
    missingSince: null,
  };

  if (classification.cls === "IRRELEVANT" && existing?.reviewDecision !== "ACCEPTED_AS_VISIT") {
    ctx.stats.ignored++;
    if (!existing) return; // não persiste eventos claramente irrelevantes
    await db.$transaction(async (tx) => {
      // minimiza: remove conteúdo de evento que deixou de ser visita
      await tx.sourceEvent.update({
        where: { id: existing.id },
        data: { ...base, classification: "IRRELEVANT", title: null, description: null, attendees: Prisma.DbNull, organizerEmail: null, parsed: Prisma.DbNull },
      });
      if (existing.visit && existing.visit.syncConflict === "NONE") {
        await setConflict(tx, existing.visit.id, "NO_LONGER_VISIT", {}, ctx);
      }
    });
    return;
  }

  if (existing?.reviewDecision === "REJECTED" && classification.cls !== "VISIT") {
    // gestão decidiu que não é visita: mantém só identificadores (sem título/descrição/convidados)
    ctx.stats.ignored++;
    await db.sourceEvent.update({ where: { id: existing.id }, data: base });
    return;
  }

  const description = htmlToText(ev.description);
  const attendees = (ev.attendees ?? []).map((a) => ({ email: a.email ? normalizeEmail(a.email) : null, organizer: !!a.organizer, resource: !!a.resource, responseStatus: a.responseStatus ?? null }));
  const isVisit = classification.cls === "VISIT" || existing?.reviewDecision === "ACCEPTED_AS_VISIT";
  const prefix = classification.cls === "VISIT" ? classification.prefix : "";
  const parsed = isVisit && ev.summary ? parseVisitEvent(ev.summary, description, prefix) : null;

  const content = {
    ...base,
    classification: classification.cls === "IRRELEVANT" ? ("AMBIGUOUS" as const) : classification.cls,
    title: ev.summary ?? null,
    description,
    organizerEmail: ev.organizer?.email ? normalizeEmail(ev.organizer.email) : null,
    attendees: attendees as Prisma.InputJsonValue,
    attendeesOmitted: !!ev.attendeesOmitted,
    parsed: (parsed ?? Prisma.DbNull) as Prisma.InputJsonValue,
  };

  await db.$transaction(async (tx) => {
    const source = await tx.sourceEvent.upsert({
      where: key,
      update: content,
      create: { calendarId: ctx.calendarId, googleEventId: ev.id, firstSeenAt: ctx.now, ...content },
    });
    // concorrência: trava a linha do espelho até o fim da transação
    await tx.$queryRaw`SELECT id FROM "SourceEvent" WHERE id = ${source.id} FOR UPDATE`;

    if (!isVisit) {
      ctx.stats.ambiguous++;
      return;
    }
    ctx.stats.visits++;
    if (!start || !end || !parsed) return;
    const wasCancelled = existing?.googleStatus === "cancelled";
    await upsertVisit(tx, ctx, source.id, ev, parsed, { start, end, wasCancelled });
  });
}

type Parsed = NonNullable<ReturnType<typeof parseVisitEvent>>;

async function upsertVisit(
  tx: Tx,
  ctx: Ctx,
  sourceEventId: string,
  ev: GEvent,
  parsed: Parsed,
  t: { start: Date; end: Date; wasCancelled: boolean },
) {
  const assignment = assignConsultant(ev.attendees ?? [], !!ev.attendeesOmitted, ctx.aliases);
  let visit = await tx.visit.findUnique({ where: { sourceEventId } });

  if (!visit) {
    // Evento recriado: só reaproveita visita antiga com evidência forte (mesmo iCalUID + mesma ocorrência original).
    if (ev.iCalUID) {
      const prior = await tx.sourceEvent.findFirst({
        where: {
          calendarId: ctx.calendarId,
          iCalUID: ev.iCalUID,
          googleEventId: { not: ev.id },
          googleStatus: "cancelled",
          originalStartTime: eventTimes(ev).originalStart,
          visit: { isNot: null },
        },
        include: { visit: true },
      });
      if (prior?.visit) {
        await tx.visit.update({ where: { id: prior.visit.id }, data: { sourceEventId: null } });
        visit = await tx.visit.update({ where: { id: prior.visit.id }, data: { sourceEventId } });
        await audit(tx, { actorId: null, action: "sync.visit_relinked_same_uid", entityType: "Visit", entityId: visit.id });
        if (visit.autoCanceled) {
          visit = await tx.visit.update({ where: { id: visit.id }, data: { status: "SCHEDULED", autoCanceled: false, note: null, concludedAt: null, concludedById: null } });
        } else if (visit.syncConflict === "CANCELED_IN_GOOGLE") {
          visit = await tx.visit.update({ where: { id: visit.id }, data: { syncConflict: "NONE", conflictDetail: Prisma.DbNull } });
        }
      }
    }
  }

  if (!visit) {
    const link = await resolveClient(tx, { clientName: parsed.clientName, phoneRaw: parsed.phoneRaw });
    const created = await tx.visit.create({
      data: {
        origin: "GOOGLE",
        sourceEventId,
        scheduledStart: t.start,
        scheduledEnd: t.end,
        clientName: parsed.clientName,
        phoneRaw: parsed.phoneRaw,
        phoneNormalized: parsed.phoneNormalized,
        propertyCode: parsed.propertyCode,
        propertyId: await ensureProperty(tx, parsed.propertyCode),
        externalRef: parsed.externalRef,
        consultantId: assignment.consultantId,
        assignmentStatus: assignment.status,
        assignmentNote: assignment.note,
        ...link,
      },
    });
    ctx.stats.created++;
    // Evidência fraca de recriação (mesmo telefone e imóvel, visita anterior cancelada no Google): revisão humana.
    if (parsed.phoneNormalized && parsed.propertyCode) {
      const candidate = await tx.visit.findFirst({
        where: {
          id: { not: created.id },
          phoneNormalized: parsed.phoneNormalized,
          propertyCode: parsed.propertyCode,
          OR: [{ autoCanceled: true }, { syncConflict: "CANCELED_IN_GOOGLE" }],
          scheduledStart: { gte: new Date(t.start.getTime() - 14 * DAY), lte: new Date(t.start.getTime() + 14 * DAY) },
        },
      });
      if (candidate) await setConflict(tx, created.id, "POSSIBLE_RECREATION", { candidateVisitId: candidate.id }, ctx);
    }
    return;
  }

  const manual = new Set(visit.manualFields);
  const concluded = visit.status !== "SCHEDULED" && !visit.autoCanceled;

  // Evento voltou a existir após cancelamento automático
  if (t.wasCancelled && visit.autoCanceled) {
    visit = await tx.visit.update({ where: { id: visit.id }, data: { status: "SCHEDULED", autoCanceled: false, note: null, concludedAt: null, concludedById: null } });
    await tx.visitOutcomeHistory.create({ data: { visitId: visit.id, status: "SCHEDULED", note: "Evento restaurado na agenda Google" } });
  } else if (t.wasCancelled && visit.syncConflict === "CANCELED_IN_GOOGLE") {
    visit = await tx.visit.update({ where: { id: visit.id }, data: { syncConflict: "NONE", conflictDetail: Prisma.DbNull } });
  }
  if (visit.syncConflict === "NO_LONGER_VISIT") {
    visit = await tx.visit.update({ where: { id: visit.id }, data: { syncConflict: "NONE", conflictDetail: Prisma.DbNull } });
  }

  const google: Record<string, string | null> = {};
  const current: Record<string, string | null> = {};
  const cmp = (field: string, g: string | null, c: string | null) => {
    if ((g ?? null) !== (c ?? null)) {
      google[field] = g;
      current[field] = c;
    }
  };
  if (visit.scheduledStart.getTime() !== t.start.getTime()) cmp("scheduledStart", t.start.toISOString(), visit.scheduledStart.toISOString());
  if (visit.scheduledEnd.getTime() !== t.end.getTime()) cmp("scheduledEnd", t.end.toISOString(), visit.scheduledEnd.toISOString());
  if (!manual.has("clientName")) cmp("clientName", parsed.clientName, visit.clientName);
  if (!manual.has("phone")) cmp("phoneRaw", parsed.phoneRaw, visit.phoneRaw);
  if (!manual.has("propertyCode")) cmp("propertyCode", parsed.propertyCode, visit.propertyCode);

  if (concluded) {
    // Google nunca sobrescreve visita já concluída: diferença vira conflito para revisão.
    if (Object.keys(google).length) {
      const prev = JSON.stringify((visit.conflictDetail as { google?: unknown } | null)?.google ?? null);
      if (visit.syncConflict !== "CHANGED_AFTER_CONCLUSION" || prev !== JSON.stringify(google)) {
        await setConflict(tx, visit.id, "CHANGED_AFTER_CONCLUSION", { google, current }, ctx);
      }
    }
    return;
  }

  const data: Prisma.VisitUncheckedUpdateInput = {};
  if ("scheduledStart" in google) data.scheduledStart = t.start;
  if ("scheduledEnd" in google) data.scheduledEnd = t.end;
  if ("clientName" in google) data.clientName = parsed.clientName;
  if ("phoneRaw" in google) {
    data.phoneRaw = parsed.phoneRaw;
    data.phoneNormalized = parsed.phoneNormalized;
  }
  if ("propertyCode" in google) {
    data.propertyCode = parsed.propertyCode;
    data.propertyId = await ensureProperty(tx, parsed.propertyCode);
  }
  if (!visit.externalRef && parsed.externalRef) data.externalRef = parsed.externalRef;
  // Atribuição manual nunca é sobrescrita pela sincronização.
  if (visit.assignmentStatus !== "MANUAL" && !manual.has("consultantId")) {
    if (visit.consultantId !== assignment.consultantId || visit.assignmentStatus !== assignment.status) {
      data.consultantId = assignment.consultantId;
      data.assignmentStatus = assignment.status;
      data.assignmentNote = assignment.note;
    }
  }
  if (("clientName" in google || "phoneRaw" in google) && visit.clientMatch !== "CONFIRMED_MANUAL") {
    const link = await resolveClient(tx, {
      clientName: parsed.clientName,
      phoneRaw: manual.has("phone") ? visit.phoneRaw : parsed.phoneRaw,
      currentClientId: visit.clientId,
    });
    Object.assign(data, link);
  }
  if (Object.keys(data).length === 0) return;
  await tx.visit.update({ where: { id: visit.id }, data });
  ctx.stats.updated++;
  if ("scheduledStart" in data || "consultantId" in data) {
    await audit(tx, {
      actorId: null,
      action: "sync.visit_updated",
      entityType: "Visit",
      entityId: visit.id,
      changes: {
        ...("scheduledStart" in data ? { horarioAnterior: visit.scheduledStart.toISOString(), horarioNovo: t.start.toISOString() } : {}),
        ...("consultantId" in data ? { consultoraAnterior: visit.consultantId, consultoraNova: assignment.consultantId } : {}),
      },
    });
  }
  if ("clientId" in data && data.clientId !== visit.clientId && visit.clientId) {
    await cleanupOrphanClient(tx, visit.clientId);
  }
}

async function setConflict(tx: Tx, visitId: string, conflict: "CANCELED_IN_GOOGLE" | "NO_LONGER_VISIT" | "CHANGED_AFTER_CONCLUSION" | "POSSIBLE_RECREATION", detail: Record<string, unknown>, ctx: Ctx) {
  await tx.visit.update({ where: { id: visitId }, data: { syncConflict: conflict, conflictDetail: detail as Prisma.InputJsonValue } });
  await audit(tx, { actorId: null, action: "sync.conflict", entityType: "Visit", entityId: visitId, changes: { conflito: conflict } });
  ctx.stats.conflicts++;
}

/** Cancelamento/exclusão no Google: visita sem resultado é cancelada automaticamente; com resultado vira conflito. */
async function handleCancellation(tx: Tx, visitId: string, ctx: Ctx) {
  const v = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });
  if (v.status === "SCHEDULED") {
    await tx.visit.update({
      where: { id: v.id },
      data: { status: "CANCELED", autoCanceled: true, concludedAt: ctx.now, concludedById: null, note: null },
    });
    await tx.visitOutcomeHistory.create({ data: { visitId: v.id, status: "CANCELED", note: "Cancelada/excluída na agenda Google" } });
    ctx.stats.canceled++;
  } else if (!v.autoCanceled && v.syncConflict !== "CANCELED_IN_GOOGLE") {
    await setConflict(tx, v.id, "CANCELED_IN_GOOGLE", {}, ctx);
  }
}

async function listAll(ctx: Ctx, params: { syncToken?: string; timeMin?: string; timeMax?: string }, onPage: (items: GEvent[]) => Promise<void>) {
  let pageToken: string | undefined;
  let nextSyncToken: string | null | undefined;
  do {
    const page = await withRetry(() => ctx.api.listEvents({ calendarId: ctx.calendarId, ...params, pageToken }), ctx.sleep);
    ctx.stats.pages++;
    await onPage(page.items);
    pageToken = page.nextPageToken ?? undefined;
    nextSyncToken = page.nextSyncToken;
  } while (pageToken);
  return nextSyncToken ?? null;
}

/** Executa uma sincronização. Chamado pelo worker sob advisory lock. */
export async function runSync(context: SyncContext): Promise<SyncStats> {
  const now = context.now ?? new Date();
  const sleep = context.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const conn = await db.googleConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } });
  if (!conn) throw Object.assign(new Error("Integração Google não conectada"), { code: "NOT_CONNECTED" });
  if (conn.status === "NEEDS_RECONNECT") throw Object.assign(new Error("Reconexão necessária"), { code: "NEEDS_RECONNECT" });
  if (!conn.calendarId) throw Object.assign(new Error("Calendário não selecionado"), { code: "NO_CALENDAR" });
  if (!conn.calendarAccessRole || !DETAIL_ROLES.has(conn.calendarAccessRole)) {
    throw Object.assign(new Error("Conta sem acesso aos detalhes do calendário"), { code: "FREEBUSY_ONLY" });
  }

  const settings = await getSettings();
  const ctx: Ctx = {
    api: context.api,
    now,
    calendarId: conn.calendarId,
    patterns: await getPatternConfig(),
    aliases: await loadAliases(),
    sleep,
    seen: new Set(),
    stats: { mode: "incremental", pages: 0, received: 0, visits: 0, ambiguous: 0, ignored: 0, created: 0, updated: 0, canceled: 0, conflicts: 0, windowExtended: false, reconciled: 0 },
  };
  const desiredStart = new Date(now.getTime() - settings.syncPastDays * DAY);
  const desiredEnd = new Date(now.getTime() + settings.syncFutureDays * DAY);

  let state = await db.syncState.upsert({ where: { calendarId: conn.calendarId }, update: { lastAttemptAt: now }, create: { calendarId: conn.calendarId, lastAttemptAt: now } });
  const needsReconcile = !state.lastReconcileAt || now.getTime() - state.lastReconcileAt.getTime() > RECONCILE_EVERY_MS;
  const doFull = context.full || !state.syncToken || needsReconcile;

  if (!doFull) {
    try {
      const token = await listAll(ctx, { syncToken: state.syncToken! }, async (items) => {
        for (const ev of items) await processEvent(ctx, ev, { inWindowOnly: true, windowStart: state.windowStart, windowEnd: state.windowEnd });
      });
      if (token) state = await db.syncState.update({ where: { calendarId: conn.calendarId }, data: { syncToken: token } });
    } catch (e) {
      if (e instanceof GoogleApiError && e.kind === "SYNC_TOKEN_INVALID") {
        log.warn("sync.token_invalid_full_resync", { calendar: "selected" });
        await db.syncState.update({ where: { calendarId: conn.calendarId }, data: { syncToken: null } });
        return runSync({ ...context, now, full: true });
      }
      throw e;
    }
    // Expansão explícita da janela futura
    if (state.windowEnd && desiredEnd.getTime() > state.windowEnd.getTime()) {
      await listAll(ctx, { timeMin: state.windowEnd.toISOString(), timeMax: desiredEnd.toISOString() }, async (items) => {
        for (const ev of items) await processEvent(ctx, ev, { inWindowOnly: false });
      });
      await db.syncState.update({ where: { calendarId: conn.calendarId }, data: { windowEnd: desiredEnd } });
      ctx.stats.windowExtended = true;
    }
  } else {
    ctx.stats.mode = "full";
    const token = await listAll(ctx, { timeMin: desiredStart.toISOString(), timeMax: desiredEnd.toISOString() }, async (items) => {
      for (const ev of items) await processEvent(ctx, ev, { inWindowOnly: false });
    });
    // Reconciliação: eventos conhecidos na janela que não vieram na listagem completa
    const known = await db.sourceEvent.findMany({
      where: { calendarId: conn.calendarId, googleStatus: { not: "cancelled" }, startAt: { gte: desiredStart, lt: desiredEnd } },
      select: { id: true, googleEventId: true },
    });
    for (const k of known) {
      if (ctx.seen.has(k.googleEventId)) continue;
      const ev = await withRetry(() => ctx.api.getEvent(conn.calendarId!, k.googleEventId), sleep);
      ctx.stats.reconciled++;
      if (ev) await processEvent(ctx, ev, { inWindowOnly: false });
      else await processEvent(ctx, { id: k.googleEventId, status: "cancelled" }, { inWindowOnly: false });
    }
    await db.syncState.update({
      where: { calendarId: conn.calendarId },
      data: {
        syncToken: token,
        windowStart: state.windowStart && state.windowStart < desiredStart ? state.windowStart : desiredStart,
        windowEnd: desiredEnd,
        lastFullSyncAt: now,
        lastReconcileAt: now,
      },
    });
  }

  await db.syncState.update({
    where: { calendarId: conn.calendarId },
    data: { lastSuccessAt: now, consecutiveFailures: 0, nextAttemptAt: null, lastErrorCode: null },
  });
  return ctx.stats;
}
