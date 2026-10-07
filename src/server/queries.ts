/**
 * Consultas de leitura — todas aplicam o escopo de autorização (visitScope/opportunityScope) no servidor.
 */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { canViewVisit, hasGlobalView, opportunityScope, visitScope, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { addDays, dateOnlyKey, dayKey, endOfDayInTz, isDayKey, startOfDayInTz } from "@/lib/time";
import { computeMetrics, type MetricOpportunity, type MetricVisit } from "@/lib/metrics";
import type { VisitStatus } from "@/generated/prisma/enums";

export const visitListSelect = {
  id: true,
  origin: true,
  scheduledStart: true,
  scheduledEnd: true,
  clientName: true,
  phoneRaw: true,
  phoneNormalized: true,
  propertyCode: true,
  status: true,
  evaluation: true,
  consultantId: true,
  assignmentStatus: true,
  syncConflict: true,
  excluded: true,
  autoCanceled: true,
  version: true,
  consultant: { select: { id: true, name: true } },
} satisfies Prisma.VisitSelect;

export type VisitListItem = Prisma.VisitGetPayload<{ select: typeof visitListSelect }>;

async function chargeStart() {
  const s = await getSettings();
  return startOfDayInTz(dateOnlyKey(s.resultsStartDate));
}

export async function listToday(actor: AuthzActor, now = new Date()) {
  const key = dayKey(now);
  const [visits, pendingCount, oldestPending] = await Promise.all([
    db.visit.findMany({
      where: { ...visitScope(actor), excluded: false, scheduledStart: { gte: startOfDayInTz(key), lt: endOfDayInTz(key) } },
      select: visitListSelect,
      orderBy: { scheduledStart: "asc" },
    }),
    db.visit.count({ where: await awaitingWhere(actor, now, startOfDayInTz(key)) }),
    db.visit.findFirst({ where: await awaitingWhere(actor, now, startOfDayInTz(key)), orderBy: { scheduledStart: "asc" }, select: { scheduledStart: true } }),
  ]);
  return { dayKey: key, visits, previousPending: pendingCount, oldestPending: oldestPending?.scheduledStart ?? null };
}

async function awaitingWhere(actor: AuthzActor, now: Date, before?: Date): Promise<Prisma.VisitWhereInput> {
  return {
    ...visitScope(actor),
    excluded: false,
    status: "SCHEDULED",
    scheduledEnd: { lte: before && before < now ? before : now },
    scheduledStart: { gte: await chargeStart() },
  };
}

/**
 * Tela única da consultora: o que registrar, o que vem pela frente e o que já registrou.
 * Escopo sempre restrito à própria consultora.
 */
export async function listMine(actor: AuthzActor, now = new Date()) {
  const scope = { ...visitScope(actor), excluded: false };
  const today = dayKey(now);
  const [awaiting, upcoming, done] = await Promise.all([
    db.visit.findMany({ where: await awaitingWhere(actor, now), select: visitListSelect, orderBy: { scheduledStart: "asc" } }),
    db.visit.findMany({
      where: { ...scope, status: "SCHEDULED", scheduledEnd: { gt: now }, scheduledStart: { lt: endOfDayInTz(addDays(today, 1)) } },
      select: visitListSelect,
      orderBy: { scheduledStart: "asc" },
    }),
    db.visit.findMany({
      where: { ...scope, status: { not: "SCHEDULED" }, scheduledStart: { gte: startOfDayInTz(addDays(today, -6)) } },
      select: { ...visitListSelect, note: true },
      orderBy: { scheduledStart: "desc" },
      take: 30,
    }),
  ]);
  return { awaiting, upcoming, done, today };
}

/** Próxima visita aguardando resultado (a mais antiga), para encadear registros. */
export async function nextPending(actor: AuthzActor, excludeId: string, now = new Date()) {
  const where = { ...(await awaitingWhere(actor, now)), id: { not: excludeId }, consultantId: hasGlobalView(actor) ? { not: null } : actor.id };
  const [next, remaining] = await Promise.all([
    db.visit.findFirst({ where, orderBy: { scheduledStart: "asc" }, select: { id: true } }),
    db.visit.count({ where }),
  ]);
  return next ? { id: next.id, remaining } : null;
}

/** Pendências: resultados aguardando registro e dados/identificação a corrigir. */
export async function listPending(actor: AuthzActor, now = new Date()) {
  const awaiting = await db.visit.findMany({ where: await awaitingWhere(actor, now), select: visitListSelect, orderBy: { scheduledStart: "asc" } });
  const dataIssues = await db.visit.findMany({
    where: {
      ...visitScope(actor),
      excluded: false,
      status: { in: ["SCHEDULED", "DONE"] },
      OR: [{ clientName: null }, { propertyCode: null }, { phoneNormalized: null }],
      scheduledStart: { gte: new Date(now.getTime() - 60 * 86400_000) },
    },
    select: visitListSelect,
    orderBy: { scheduledStart: "desc" },
    take: 100,
  });
  return { awaiting, dataIssues };
}

export type HistoryFilter = {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  consultantId?: string;
  page?: number;
};

/** Filtro do histórico (também usado na exportação). Sempre inclui o escopo do usuário. */
export function historyWhere(actor: AuthzActor, f: HistoryFilter): Prisma.VisitWhereInput {
  const where: Prisma.VisitWhereInput = { ...visitScope(actor) };
  const and: Prisma.VisitWhereInput[] = [];
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const or: Prisma.VisitWhereInput[] = [
      { clientName: { contains: q, mode: "insensitive" } },
      { propertyCode: { contains: q, mode: "insensitive" } },
    ];
    if (digits.length >= 3) {
      or.push({ phoneNormalized: { contains: digits } }, { phoneRaw: { contains: q } });
    }
    and.push({ OR: or });
  }
  if (isDayKey(f.from)) and.push({ scheduledStart: { gte: startOfDayInTz(f.from) } });
  if (isDayKey(f.to)) and.push({ scheduledStart: { lt: endOfDayInTz(f.to) } });
  const statuses: VisitStatus[] = ["SCHEDULED", "DONE", "NO_SHOW", "CANCELED", "RESCHEDULED"];
  if (f.status && (statuses as string[]).includes(f.status)) and.push({ status: f.status as VisitStatus });
  if (f.status === "POSITIVE" || f.status === "NEGATIVE" || f.status === "UNDECIDED") and.push({ evaluation: f.status });
  if (f.consultantId && hasGlobalView(actor)) and.push({ consultantId: f.consultantId === "none" ? null : f.consultantId });
  if (and.length) where.AND = and;
  return where;
}

export async function listHistory(actor: AuthzActor, f: HistoryFilter) {
  const where = historyWhere(actor, f);
  const take = 30;
  const page = Math.max(1, f.page ?? 1);
  const [items, total] = await Promise.all([
    db.visit.findMany({ where, select: visitListSelect, orderBy: { scheduledStart: "desc" }, skip: (page - 1) * take, take }),
    db.visit.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

/** Detalhe com histórico; visitas relacionadas do cliente restritas ao escopo da usuária. */
export async function getVisitDetail(actor: AuthzActor, id: string, now = new Date()) {
  const visit = await db.visit.findUnique({
    where: { id },
    include: {
      consultant: { select: { id: true, name: true } },
      negativeReason: true,
      concludedBy: { select: { name: true } },
      client: { select: { id: true, name: true, identityStatus: true } },
      opportunity: { include: { events: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } }, responsible: { select: { name: true } }, lostReason: true } },
      history: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      sourceEvent: { select: { description: true, title: true, organizerEmail: true, attendees: true, attendeesOmitted: true, googleStatus: true } },
    },
  });
  if (!visit || !canViewVisit(actor, visit)) throw notFound();
  const relatedVisits = visit.clientId
    ? await db.visit.findMany({
        where: { ...visitScope(actor), clientId: visit.clientId, id: { not: visit.id } },
        select: { ...visitListSelect, note: true },
        orderBy: { scheduledStart: "desc" },
        take: 20,
      })
    : [];
  const settings = await getSettings();
  const charged = visit.scheduledStart >= startOfDayInTz(dateOnlyKey(settings.resultsStartDate));
  const awaiting = visit.status === "SCHEDULED" && visit.scheduledEnd <= now && charged && !visit.excluded;
  return { visit, relatedVisits, awaiting, charged, settings };
}

// ─────────────── Revisão (gestão) ───────────────

export async function reviewQueues() {
  const [assignment, conflicts, ambiguous, suggested, missing, pendingClients] = await Promise.all([
    db.visit.findMany({ where: { assignmentStatus: "NEEDS_REVIEW", excluded: false }, select: { ...visitListSelect, assignmentNote: true }, orderBy: { scheduledStart: "asc" } }),
    db.visit.findMany({ where: { syncConflict: { not: "NONE" } }, select: { ...visitListSelect, conflictDetail: true }, orderBy: { scheduledStart: "asc" } }),
    db.sourceEvent.findMany({
      where: { classification: "AMBIGUOUS", reviewDecision: null, googleStatus: { not: "cancelled" } },
      select: { id: true, title: true, startAt: true, endAt: true, attendees: true },
      orderBy: { startAt: "asc" },
      take: 200,
    }),
    db.visit.findMany({ where: { clientMatch: "SUGGESTED", excluded: false }, select: { ...visitListSelect, clientId: true, clientCandidates: true }, orderBy: { scheduledStart: "asc" } }),
    db.visit.findMany({
      where: { excluded: false, status: { in: ["SCHEDULED", "DONE"] }, OR: [{ clientName: null }, { propertyCode: null }] },
      select: visitListSelect,
      orderBy: { scheduledStart: "asc" },
      take: 200,
    }),
    db.client.count({ where: { identityStatus: "PENDING", mergedIntoId: null } }),
  ]);
  const candidateIds = [...new Set(suggested.flatMap((s) => s.clientCandidates))];
  const candidates = candidateIds.length
    ? await db.client.findMany({ where: { id: { in: candidateIds } }, select: { id: true, name: true, identityStatus: true } })
    : [];
  return { assignment, conflicts, ambiguous, suggested, candidates, missing, pendingClients };
}

// ─────────────── Painel ───────────────

export type DashboardFilter = { from?: string; to?: string; consultantId?: string; propertyCode?: string };

export function defaultPeriod(now = new Date()) {
  const today = dayKey(now);
  return { from: today.slice(0, 8) + "01", to: today };
}

export async function dashboard(actor: AuthzActor, f: DashboardFilter, now = new Date()) {
  const def = defaultPeriod(now);
  const from = isDayKey(f.from) ? f.from : def.from;
  const to = isDayKey(f.to) && f.to >= from ? f.to : def.to;
  const settings = await getSettings();
  const consultantId = hasGlobalView(actor) ? f.consultantId || null : actor.id;
  const propertyCode = f.propertyCode?.trim() || null;

  const visitsRaw = await db.visit.findMany({
    where: { ...visitScope(actor), scheduledStart: { gte: startOfDayInTz(from), lt: endOfDayInTz(to) } },
    select: {
      id: true, status: true, evaluation: true, scheduledStart: true, scheduledEnd: true, consultantId: true, realizedById: true,
      propertyCode: true, clientId: true, clientMatch: true, negativeReasonId: true, excluded: true,
      client: { select: { identityStatus: true } },
    },
  });
  const visits: MetricVisit[] = visitsRaw.map((v) => ({ ...v, clientIdentity: v.client?.identityStatus ?? null }));
  // oportunidades relevantes: coorte, fechamentos e perdas no período, além das abertas
  const oppsRaw = await db.opportunity.findMany({
    where: {
      ...opportunityScope(actor),
      OR: [
        { firstDoneVisitAt: { gte: startOfDayInTz(from), lt: endOfDayInTz(to) } },
        { closedAt: { gte: new Date(from + "T00:00:00Z"), lte: new Date(to + "T00:00:00Z") } },
        { lostAt: { gte: startOfDayInTz(from), lt: endOfDayInTz(to) } },
        { status: { in: ["FOLLOW_UP", "DOCS_REVIEW"] } },
      ],
    },
    include: { property: { select: { code: true } } },
  });
  const opps: MetricOpportunity[] = oppsRaw.map((o) => ({ ...o, propertyCode: o.property.code }));
  const base = { from, to, now, resultsStartDate: dateOnlyKey(settings.resultsStartDate), propertyCode };
  const metrics = computeMetrics(visits, opps, { ...base, consultantId });
  // visão da equipe (para comparação na visão individual) e métricas por consultora
  const team = consultantId ? computeMetrics(visits, opps, { ...base, consultantId: null }) : metrics;
  const consultantUsers = hasGlobalView(actor)
    ? await db.user.findMany({ where: { role: "CONSULTANT" }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } })
    : [];
  const perConsultant = consultantUsers
    .map((u) => ({ user: u, metrics: computeMetrics(visits, opps, { ...base, consultantId: u.id }) }))
    .filter((c) => c.user.active || c.metrics.totals.scheduled > 0);

  // período anterior de mesmo tamanho para comparação
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const prevVisitsRaw = await db.visit.findMany({
    where: { ...visitScope(actor), scheduledStart: { gte: startOfDayInTz(prevFrom), lt: endOfDayInTz(prevTo) } },
    select: { id: true, status: true, evaluation: true, scheduledStart: true, scheduledEnd: true, consultantId: true, realizedById: true, propertyCode: true, clientId: true, clientMatch: true, negativeReasonId: true, excluded: true },
  });
  const previous = computeMetrics(
    prevVisitsRaw.map((v) => ({ ...v, clientIdentity: null })),
    [],
    { from: prevFrom, to: prevTo, now, resultsStartDate: dateOnlyKey(settings.resultsStartDate), consultantId, propertyCode },
  );

  // Evolução semanal: 8 semanas (segunda a domingo) terminando na semana de `to`
  const toDate = new Date(to + "T12:00:00Z");
  const weekEnd = addDays(to, (7 - toDate.getUTCDay()) % 7); // domingo
  const weeksStart = addDays(weekEnd, -8 * 7 + 1);
  const weekVisitsRaw = await db.visit.findMany({
    where: { ...visitScope(actor), scheduledStart: { gte: startOfDayInTz(weeksStart), lt: endOfDayInTz(weekEnd) } },
    select: { id: true, status: true, evaluation: true, scheduledStart: true, scheduledEnd: true, consultantId: true, realizedById: true, propertyCode: true, clientId: true, clientMatch: true, negativeReasonId: true, excluded: true },
  });
  const weekVisits = weekVisitsRaw.map((v) => ({ ...v, clientIdentity: null }));
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const wFrom = addDays(weeksStart, i * 7);
    const wTo = addDays(wFrom, 6);
    const wm = computeMetrics(weekVisits, [], { ...base, from: wFrom, to: wTo, consultantId });
    return { from: wFrom, to: wTo, scheduled: wm.totals.scheduled, done: wm.totals.done, positive: wm.evaluations.positive, positiveRate: wm.positiveRate, coverage: wm.coverage, awaiting: wm.totals.awaiting, future: wFrom > dayKey(now) };
  });

  const [reasons, users] = await Promise.all([
    db.reason.findMany({ orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
    db.user.findMany({ where: hasGlobalView(actor) ? {} : { id: actor.id }, select: { id: true, name: true, role: true, active: true } }),
  ]);
  return { from, to, consultantId, propertyCode, metrics, team, perConsultant, weekly, previous: { from: prevFrom, to: prevTo, totals: previous.totals, positiveRate: previous.positiveRate }, reasons, users, settings };
}

// ─────────────── Oportunidades e clientes ───────────────

export async function listOpportunities(actor: AuthzActor, f: { status?: string; consultantId?: string; q?: string }) {
  const where: Prisma.OpportunityWhereInput = { ...opportunityScope(actor) };
  if (f.status === "OPEN" || !f.status) where.status = { in: ["FOLLOW_UP", "DOCS_REVIEW"] };
  else if (["FOLLOW_UP", "DOCS_REVIEW", "CLOSED_WON", "LOST"].includes(f.status)) where.status = f.status as never;
  if (f.consultantId && hasGlobalView(actor)) where.responsibleId = f.consultantId;
  if (f.q?.trim()) where.OR = [{ client: { name: { contains: f.q.trim(), mode: "insensitive" } } }, { property: { code: { contains: f.q.trim() } } }];
  return db.opportunity.findMany({
    where,
    include: {
      client: { select: { id: true, name: true, identityStatus: true } },
      property: { select: { code: true } },
      responsible: { select: { id: true, name: true } },
      _count: { select: { visits: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}

export async function getOpportunity(actor: AuthzActor, id: string) {
  const opp = await db.opportunity.findFirst({
    where: { id, ...opportunityScope(actor) },
    include: {
      client: { select: { id: true, name: true, identityStatus: true } },
      property: true,
      responsible: { select: { id: true, name: true } },
      closedResponsible: { select: { name: true } },
      lostReason: true,
      events: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      visits: { where: visitScope(actor), select: visitListSelect, orderBy: { scheduledStart: "asc" } },
    },
  });
  if (!opp) throw notFound();
  return opp;
}

export async function listClients(f: { q?: string; identity?: string }) {
  const where: Prisma.ClientWhereInput = { mergedIntoId: null };
  if (f.identity === "PENDING" || f.identity === "CONFIRMED") where.identityStatus = f.identity;
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [{ name: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phones: { some: { normalized: { contains: digits } } } }] : [])];
  }
  return db.client.findMany({
    where,
    include: { phones: true, _count: { select: { visits: true, opportunities: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
}

export async function getClient(id: string) {
  const client = await db.client.findUnique({
    where: { id },
    include: {
      phones: true,
      visits: { select: visitListSelect, orderBy: { scheduledStart: "desc" } },
      opportunities: { include: { property: true, responsible: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!client) throw notFound();
  return client;
}
