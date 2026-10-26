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
import { cleanAddress } from "@/lib/address";
import { LINK_CODE_RE } from "../reschedule";
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
  /** evento movido para este horário (local) ou depois = cancelamento pelo pré-atendimento; 0 = desligado */
  cancelAfterHour: number;
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
  const existing = await db.sourceEvent.findUnique({ where: key, include: { visit: { include: { client: { select: { anonymizedAt: true } } } } } });

  // evento descartado na limpeza dos dados de teste: nunca mais vira visita nem guarda conteúdo
  if (existing?.ignoredAt) {
    ctx.stats.ignored++;
    await db.sourceEvent.update({ where: { id: existing.id }, data: { googleStatus: ev.status ?? "confirmed", lastSeenAt: ctx.now } });
    return;
  }

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

  // LGPD: cliente anonimizado — só horários/status; nenhum conteúdo do evento volta a ser gravado
  if (existing?.visit?.client?.anonymizedAt) {
    ctx.stats.ignored++;
    await db.sourceEvent.update({ where: { id: existing.id }, data: { googleStatus: ev.status ?? "confirmed", lastSeenAt: ctx.now, startAt: start, endAt: end } });
    return;
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
    // todos os códigos do título: se o 1º sair (imóvel cancelado), a principal fica e o resto continua acompanhando
    await syncCompanions(tx, ctx, source.id, [parsed.propertyCode ?? "", ...(parsed.extraPropertyCodes ?? [])], { start, end });
    await applyEventLocation(tx, parsed.propertyCode, ev.location);
  });
}

export const COMPANION_GONE_NOTE = "Imóvel retirado do evento na agenda Google";

/**
 * Evento com vários imóveis ("cod 339541;835840"): o 1º imóvel fica na visita do evento e cada imóvel
 * a mais vira uma visita acompanhante (mesmo cliente, horário e consultora), com resultado próprio.
 * As acompanhantes seguem a principal enquanto não têm resultado; cancelamentos da agenda também valem para elas.
 */
async function syncCompanions(tx: Tx, ctx: Ctx, sourceEventId: string, codes: string[], t: { start: Date; end: Date }) {
  const primary = await tx.visit.findUnique({ where: { sourceEventId }, include: { companions: true } });
  if (!primary) return;
  const wanted = [...new Set(codes.map((c) => c.trim()).filter((c) => c && c !== primary.propertyCode))];
  if (!wanted.length && !primary.companions.length) return;
  const canceledBySync = primary.status === "CANCELED" && primary.autoCanceled;
  const shared = {
    // horário vem do evento (a principal pode estar cancelada e não acompanhar mais)
    scheduledStart: t.start,
    scheduledEnd: t.end,
    clientName: primary.clientName,
    phoneRaw: primary.phoneRaw,
    phoneNormalized: primary.phoneNormalized,
    externalRef: primary.externalRef,
    clientId: primary.clientId,
    clientMatch: primary.clientMatch,
    clientCandidates: primary.clientCandidates,
    scheduledById: primary.scheduledById,
  };
  const assignment = { consultantId: primary.consultantId, assignmentStatus: primary.assignmentStatus, assignmentNote: primary.assignmentNote };

  for (const code of wanted) {
    const comp = primary.companions.find((c) => c.propertyCode === code);
    if (!comp) {
      await tx.visit.create({
        data: {
          origin: primary.origin,
          companionOfId: primary.id,
          propertyCode: code,
          propertyId: await ensureProperty(tx, code),
          excluded: primary.excluded,
          ...shared,
          ...assignment,
          ...(canceledBySync ? { status: "CANCELED" as const, autoCanceled: true, note: primary.note, concludedAt: ctx.now } : {}),
        },
      });
      ctx.stats.created++;
      continue;
    }
    if (comp.excluded) continue;
    const data: Prisma.VisitUncheckedUpdateInput = {};
    let open = comp.status === "SCHEDULED";
    if (canceledBySync && open) {
      Object.assign(data, { status: "CANCELED", autoCanceled: true, note: primary.note, concludedAt: ctx.now, concludedById: null });
      await tx.visitOutcomeHistory.create({ data: { visitId: comp.id, status: "CANCELED", note: primary.note } });
      ctx.stats.canceled++;
      open = false;
    } else if (!canceledBySync && comp.status === "CANCELED" && comp.autoCanceled) {
      Object.assign(data, { status: "SCHEDULED", autoCanceled: false, note: null, concludedAt: null, concludedById: null });
      await tx.visitOutcomeHistory.create({ data: { visitId: comp.id, status: "SCHEDULED", note: "Imóvel de volta no evento da agenda Google" } });
      open = true;
    }
    if (open) {
      // sem resultado: acompanha a principal (o que foi corrigido à mão na acompanhante é preservado)
      const manual = new Set(comp.manualFields);
      if (comp.scheduledStart.getTime() !== shared.scheduledStart.getTime()) data.scheduledStart = shared.scheduledStart;
      if (comp.scheduledEnd.getTime() !== shared.scheduledEnd.getTime()) data.scheduledEnd = shared.scheduledEnd;
      if (!manual.has("clientName") && comp.clientName !== shared.clientName) data.clientName = shared.clientName;
      if (!manual.has("phone") && (comp.phoneRaw !== shared.phoneRaw || comp.phoneNormalized !== shared.phoneNormalized)) Object.assign(data, { phoneRaw: shared.phoneRaw, phoneNormalized: shared.phoneNormalized });
      if (comp.clientMatch !== "CONFIRMED_MANUAL" && comp.clientId !== shared.clientId) Object.assign(data, { clientId: shared.clientId, clientMatch: shared.clientMatch, clientCandidates: shared.clientCandidates });
      if (comp.assignmentStatus !== "MANUAL" && !manual.has("consultantId") && comp.consultantId !== assignment.consultantId) Object.assign(data, assignment);
    }
    if (Object.keys(data).length) {
      await tx.visit.update({ where: { id: comp.id }, data: { ...data, version: { increment: 1 } } });
      ctx.stats.updated++;
    }
  }

  // imóvel tirado do evento: a acompanhante sem resultado é cancelada (volta se o código voltar)
  for (const comp of primary.companions) {
    if (comp.excluded || comp.status !== "SCHEDULED" || wanted.includes(comp.propertyCode ?? "") || comp.manualFields.includes("propertyCode")) continue;
    await tx.visit.update({ where: { id: comp.id }, data: { status: "CANCELED", autoCanceled: true, note: COMPANION_GONE_NOTE, concludedAt: ctx.now, concludedById: null, version: { increment: 1 } } });
    await tx.visitOutcomeHistory.create({ data: { visitId: comp.id, status: "CANCELED", note: COMPANION_GONE_NOTE } });
    ctx.stats.canceled++;
  }
}

/** Campo "Local" do evento vira o endereço do imóvel (rota do dia), salvo se foi digitado no app. */
async function applyEventLocation(tx: Tx, code: string | null, location: string | null | undefined) {
  const address = cleanAddress(location);
  if (!code || !address) return;
  await tx.property.updateMany({
    where: { code, OR: [{ addressSource: null }, { addressSource: "AGENDA", address: { not: address } }] },
    data: { address, addressSource: "AGENDA", addressUpdatedAt: new Date() },
  });
}

type Parsed = NonNullable<ReturnType<typeof parseVisitEvent>>;

/** Marca das visitas canceladas por "evento movido para depois das 21h" (permite restaurar se voltar ao horário normal). */
export const LATE_CANCEL_NOTE = "Cancelada pelo pré-atendimento (evento movido para depois das 21h na agenda)";
const localHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(d));
const isLateMove = (start: Date, ctx: Ctx) => ctx.cancelAfterHour > 0 && localHour(start) >= ctx.cancelAfterHour;

async function upsertVisit(
  tx: Tx,
  ctx: Ctx,
  sourceEventId: string,
  ev: GEvent,
  parsed: Parsed,
  t: { start: Date; end: Date; wasCancelled: boolean },
) {
  const scheduledById = scheduledByConsultant(ev, ctx.aliases);
  const assignment = assignConsultant(ev.attendees ?? [], !!ev.attendeesOmitted, ctx.aliases, scheduledById);
  let visit = await tx.visit.findUnique({ where: { sourceEventId } });

  // Evento criado pela consultora a partir do app (reagendamento/nova visita): o código VL-XXXXXX liga à visita já existente
  if (!visit) {
    const code = `${ev.summary ?? ""}\n${ev.description ?? ""}`.match(LINK_CODE_RE)?.[0];
    let linked = code ? await tx.visit.findUnique({ where: { linkCode: code } }) : null;
    // evento criado à mão (sem o código): mesmo telefone + mesmo imóvel, até 3 h de diferença → é a mesma visita
    if (!linked && parsed.phoneNormalized && parsed.propertyCode) {
      linked = await tx.visit.findFirst({
        where: {
          linkCode: { not: null },
          sourceEventId: null,
          status: "SCHEDULED",
          phoneNormalized: parsed.phoneNormalized,
          propertyCode: parsed.propertyCode,
          scheduledStart: { gte: new Date(t.start.getTime() - 3 * 3600_000), lte: new Date(t.start.getTime() + 3 * 3600_000) },
        },
        orderBy: { createdAt: "desc" },
      });
    }
    if (linked && !linked.sourceEventId) {
      visit = await tx.visit.update({ where: { id: linked.id }, data: { sourceEventId, scheduledStart: t.start, scheduledEnd: t.end, ...(scheduledById ? { scheduledById } : {}) } });
      await audit(tx, { actorId: null, action: "sync.visit_linked_by_code", entityType: "Visit", entityId: linked.id, changes: { codigo: code } });
      ctx.stats.updated++;
      return;
    }
  }

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
        scheduledById,
        ...link,
        // já chegou movido para depois das 21h: entra como cancelada
        ...(isLateMove(t.start, ctx) ? { status: "CANCELED" as const, autoCanceled: true, note: LATE_CANCEL_NOTE, concludedAt: ctx.now } : {}),
      },
    });
    ctx.stats.created++;
    if (created.status === "CANCELED") {
      await tx.visitOutcomeHistory.create({ data: { visitId: created.id, status: "CANCELED", note: LATE_CANCEL_NOTE } });
      ctx.stats.canceled++;
      return;
    }
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

  // Cancelamento pelo pré-atendimento: evento movido para depois das 21h.
  // O horário original é mantido na visita (indicadores ficam no dia certo). Voltando ao horário normal, restaura.
  const lateCanceled = visit.status === "CANCELED" && visit.autoCanceled && visit.note === LATE_CANCEL_NOTE;
  if (isLateMove(t.start, ctx)) {
    if (visit.status === "SCHEDULED") {
      await tx.visit.update({ where: { id: visit.id }, data: { status: "CANCELED", autoCanceled: true, note: LATE_CANCEL_NOTE, concludedAt: ctx.now, concludedById: null, version: { increment: 1 } } });
      await tx.visitOutcomeHistory.create({ data: { visitId: visit.id, status: "CANCELED", note: LATE_CANCEL_NOTE } });
      await audit(tx, { actorId: null, action: "sync.visit_late_canceled", entityType: "Visit", entityId: visit.id, changes: { horarioNaAgenda: t.start.toISOString() } });
      ctx.stats.canceled++;
    }
    // a consultora continua sendo atualizada (cancelamentos contam nos números dela)
    if (visit.assignmentStatus !== "MANUAL" && !visit.manualFields.includes("consultantId") && (visit.consultantId !== assignment.consultantId || visit.assignmentStatus !== assignment.status)) {
      await tx.visit.update({ where: { id: visit.id }, data: { consultantId: assignment.consultantId, assignmentStatus: assignment.status, assignmentNote: assignment.note } });
    }
    return; // já cancelada ou com resultado: não muda mais nada
  }
  if (lateCanceled) {
    visit = await tx.visit.update({ where: { id: visit.id }, data: { status: "SCHEDULED", autoCanceled: false, note: null, concludedAt: null, concludedById: null, version: { increment: 1 } } });
    await tx.visitOutcomeHistory.create({ data: { visitId: visit.id, status: "SCHEDULED", note: "Evento voltou para horário normal na agenda" } });
  }

  const manual = new Set(visit.manualFields);
  const concluded = visit.status !== "SCHEDULED" && !visit.autoCanceled;
  // cancelada pelo pré-atendimento no app: decisão final; o título editado na agenda não vira conflito
  if (visit.status === "CANCELED" && visit.cancelReasonId) return;
  // mesmo texto, regra de telefone nova (ex.: celular antigo ganha o 9): só a forma normalizada muda
  if (!manual.has("phone") && parsed.phoneRaw === visit.phoneRaw && parsed.phoneNormalized !== visit.phoneNormalized) {
    visit = await tx.visit.update({ where: { id: visit.id }, data: { phoneNormalized: parsed.phoneNormalized } });
  }

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
  // cada visita é de um imóvel: se o código dela continua no título (só mudou a ordem ou entrou outro na frente),
  // ela não troca de imóvel; o código novo vira outra visita do mesmo evento (acompanhante)
  const stillInTitle = !!visit.propertyCode && (parsed.extraPropertyCodes ?? []).includes(visit.propertyCode);
  if (!manual.has("propertyCode") && !stillInTitle) cmp("propertyCode", parsed.propertyCode, visit.propertyCode);

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
  if (visit.origin === "GOOGLE" && visit.scheduledById !== scheduledById) data.scheduledById = scheduledById;
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

/**
 * Consultora que marcou o evento: criadora (ou organizadora) reconhecida entre os e-mails das consultoras.
 * Eventos criados pela agenda central/organizadora retornam null.
 */
export function scheduledByConsultant(ev: Pick<GEvent, "creator" | "organizer">, consultantAliases: Map<string, string>): string | null {
  for (const email of [ev.creator?.email, ev.organizer?.email]) {
    const userId = email ? consultantAliases.get(normalizeEmail(email)) : undefined;
    if (userId) return userId;
  }
  return null;
}

async function setConflict(tx: Tx, visitId: string, conflict: "CANCELED_IN_GOOGLE" | "NO_LONGER_VISIT" | "CHANGED_AFTER_CONCLUSION" | "POSSIBLE_RECREATION", detail: Record<string, unknown>, ctx: Ctx) {
  await tx.visit.update({ where: { id: visitId }, data: { syncConflict: conflict, conflictDetail: detail as Prisma.InputJsonValue } });
  await audit(tx, { actorId: null, action: "sync.conflict", entityType: "Visit", entityId: visitId, changes: { conflito: conflict } });
  ctx.stats.conflicts++;
}

/** Cancelamento/exclusão no Google: visita sem resultado é cancelada automaticamente; com resultado vira conflito. */
async function handleCancellation(tx: Tx, visitId: string, ctx: Ctx) {
  const v = await tx.visit.findUniqueOrThrow({ where: { id: visitId }, include: { companions: { select: { id: true } } } });
  // evento com vários imóveis: o cancelamento vale para cada visita do evento
  for (const c of v.companions) await handleCancellation(tx, c.id, ctx);
  if (v.status === "SCHEDULED") {
    await tx.visit.update({
      where: { id: v.id },
      data: { status: "CANCELED", autoCanceled: true, concludedAt: ctx.now, concludedById: null, note: null },
    });
    await tx.visitOutcomeHistory.create({ data: { visitId: v.id, status: "CANCELED", note: "Cancelada/excluída na agenda Google" } });
    ctx.stats.canceled++;
  } else if (v.status === "CANCELED" || v.status === "RESCHEDULED") {
    // já cancelada/remarcada no app (ex.: a consultora reagendou): apagar o evento antigo é o esperado, sem conflito
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
    cancelAfterHour: settings.cancelAfterHour,
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
