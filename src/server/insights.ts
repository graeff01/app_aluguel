/**
 * Visões de gestão: imóveis, funil de oportunidades, oportunidades paradas e cobrança de pendências.
 * Todas exigem visão global (gestora/admin).
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { hitRateLimit } from "@/lib/ratelimit";
import { dateOnlyKey, dayKey, endOfDayInTz, startOfDayInTz } from "@/lib/time";
import { computeMetrics, rate } from "@/lib/metrics";
import { pushConfig, sendPush } from "@/lib/push";

const DAY = 86400_000;
const ACTIVE = ["FOLLOW_UP", "DOCS_REVIEW"] as const;

// ─────────────── Imóveis ───────────────

export async function listProperties(actor: AuthzActor, q?: string) {
  assert(hasGlobalView(actor));
  const term = q?.trim();
  const props = await db.property.findMany({
    where: {
      visits: { some: {} },
      ...(term ? { OR: [{ code: { contains: term } }, { title: { contains: term, mode: "insensitive" } }, { neighborhood: { contains: term, mode: "insensitive" } }] } : {}),
    },
    include: { visits: { where: { excluded: false }, select: { status: true, evaluation: true, scheduledStart: true } }, opportunities: { select: { status: true } } },
    take: 300,
  });
  return props
    .map((p) => {
      const done = p.visits.filter((v) => v.status === "DONE");
      const positive = done.filter((v) => v.evaluation === "POSITIVE").length;
      const last = p.visits.reduce<Date | null>((a, v) => (!a || v.scheduledStart > a ? v.scheduledStart : a), null);
      return {
        code: p.code,
        title: p.title,
        photoUrl: p.photoUrl,
        visits: p.visits.length,
        done: done.length,
        positive,
        negative: done.filter((v) => v.evaluation === "NEGATIVE").length,
        positiveRate: rate(positive, done.length),
        closed: p.opportunities.filter((o) => o.status === "CLOSED_WON").length,
        lastVisit: last,
      };
    })
    .sort((a, b) => b.visits - a.visits || (b.lastVisit?.getTime() ?? 0) - (a.lastVisit?.getTime() ?? 0));
}

export async function propertyDetail(actor: AuthzActor, code: string, now = new Date()) {
  assert(hasGlobalView(actor));
  const p = await db.property.findUnique({
    where: { code },
    include: {
      visits: {
        orderBy: { scheduledStart: "desc" },
        include: { consultant: { select: { name: true } }, negativeReason: { select: { label: true } }, client: { select: { identityStatus: true } } },
      },
      opportunities: { include: { client: { select: { name: true } }, responsible: { select: { name: true } }, lostReason: true }, orderBy: { updatedAt: "desc" } },
    },
  });
  if (!p) throw notFound();
  const settings = await getSettings();
  const first = p.visits.at(-1)?.scheduledStart ?? now;
  const metrics = computeMetrics(
    p.visits.map((v) => ({ ...v, clientIdentity: v.client?.identityStatus ?? null })),
    p.opportunities.map((o) => ({ ...o, propertyCode: p.code })),
    { from: dayKey(first), to: dayKey(now), now, resultsStartDate: dateOnlyKey(settings.resultsStartDate) },
  );
  const reasonLabel = new Map(p.visits.filter((v) => v.negativeReason).map((v) => [v.negativeReasonId!, v.negativeReason!.label]));
  return { property: p, metrics, reasonLabel, settings };
}

// ─────────────── Funil (coorte de oportunidades) ───────────────

export async function opportunityFunnel(actor: AuthzActor, f: { from: string; to: string; consultantId?: string | null; propertyCode?: string | null }) {
  assert(hasGlobalView(actor));
  const opps = await db.opportunity.findMany({
    where: {
      firstDoneVisitAt: { gte: startOfDayInTz(f.from), lt: endOfDayInTz(f.to) },
      ...(f.consultantId ? { responsibleId: f.consultantId } : {}),
      ...(f.propertyCode ? { property: { code: f.propertyCode } } : {}),
    },
    include: { visits: { select: { evaluation: true } }, events: { where: { toStatus: "DOCS_REVIEW" }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const positive = opps.filter((o) => o.visits.some((v) => v.evaluation === "POSITIVE"));
  const docs = opps.filter((o) => o.events.length > 0 || o.status === "CLOSED_WON");
  const closed = opps.filter((o) => o.status === "CLOSED_WON" && o.closedAt);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const daysToDocs = avg(docs.filter((o) => o.events[0]).map((o) => (o.events[0].createdAt.getTime() - o.firstDoneVisitAt.getTime()) / DAY));
  const daysToClose = avg(closed.map((o) => (new Date(dateOnlyKey(o.closedAt!) + "T15:00:00Z").getTime() - o.firstDoneVisitAt.getTime()) / DAY));
  return {
    steps: [
      { key: "started", label: "Oportunidades iniciadas", hint: "1ª visita realizada no período", count: opps.length },
      { key: "positive", label: "Com visita positiva", hint: "alguma visita avaliada como positiva", count: positive.length },
      { key: "docs", label: "Chegaram à documentação", hint: "passaram por documentação em análise", count: docs.length },
      { key: "closed", label: "Locação fechada", hint: "até hoje", count: closed.length },
    ],
    daysToDocs,
    daysToClose,
    open: opps.filter((o) => (ACTIVE as readonly string[]).includes(o.status)).length,
  };
}

// ─────────────── Oportunidades paradas ───────────────

/** Última movimentação: evento de andamento ou visita, o que for mais recente. */
export async function staleOpportunities(actor: AuthzActor, now = new Date()) {
  assert(hasGlobalView(actor));
  const settings = await getSettings();
  const limit = new Date(now.getTime() - settings.staleOpportunityDays * DAY);
  const active = await db.opportunity.findMany({
    where: { status: { in: [...ACTIVE] } },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      visits: { orderBy: { scheduledStart: "desc" }, take: 1, select: { scheduledStart: true } },
      client: { select: { name: true } },
      property: { select: { code: true } },
      responsible: { select: { name: true } },
    },
  });
  return active
    .map((o) => {
      const last = new Date(Math.max(o.events[0]?.createdAt.getTime() ?? 0, o.visits[0]?.scheduledStart.getTime() ?? 0, o.createdAt.getTime()));
      return { ...o, lastActivity: last, idleDays: Math.floor((now.getTime() - last.getTime()) / DAY) };
    })
    .filter((o) => o.lastActivity < limit)
    .sort((a, b) => b.idleDays - a.idleDays);
}

export function lastActivityOf(o: { createdAt: Date; events?: { createdAt: Date }[]; visits?: { scheduledStart: Date }[] }) {
  return new Date(Math.max(o.events?.[0]?.createdAt.getTime() ?? 0, o.visits?.[0]?.scheduledStart.getTime() ?? 0, o.createdAt.getTime()));
}

// ─────────────── Cobrar pendências ───────────────

/** Gestão envia agora um lembrete à consultora (no máximo 1 a cada 2 h por consultora). */
export async function nudgeConsultant(actor: AuthzActor, consultantId: string, now = new Date()) {
  assert(hasGlobalView(actor));
  const consultant = await db.user.findUnique({ where: { id: consultantId }, include: { pushSubscriptions: true } });
  if (!consultant || consultant.role !== "CONSULTANT" || !consultant.active) throw new AppError("VALIDATION", "Consultora inválida.");
  const settings = await getSettings();
  const pending = await db.visit.count({
    where: { consultantId, excluded: false, status: "SCHEDULED", scheduledEnd: { lte: now }, scheduledStart: { gte: startOfDayInTz(dateOnlyKey(settings.resultsStartDate)) } },
  });
  if (pending === 0) return `${consultant.name.split(" ")[0]} não tem pendências agora.`;
  if (!pushConfig() || consultant.pushSubscriptions.length === 0) {
    throw new AppError("INVALID_STATE", `${consultant.name.split(" ")[0]} ainda não ativou os lembretes no celular. Peça para ela ativar no menu da conta.`);
  }
  const rl = await hitRateLimit(`nudge:${consultantId}`, 1, 2 * 3600);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", `Lembrete já enviado há pouco. Tente de novo em ${Math.ceil(rl.retryAfterSeconds / 60)} min.`);
  let delivered = 0;
  for (const s of consultant.pushSubscriptions) {
    const r = await sendPush(s, {
      title: `${pending === 1 ? "1 visita" : `${pending} visitas`} aguardando seu registro`,
      body: `${actor.role === "ADMIN" ? "A administração" : "A gestão"} pediu para registrar os resultados pendentes.`,
      url: "/minhas",
      tag: `cobranca-${dayKey(now)}`,
    });
    if (r === "ok") delivered++;
    else if (r === "gone") await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
  }
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "consultant.nudged", entityType: "User", entityId: consultantId, changes: { pendentes: pending, entregues: delivered } }));
  if (!delivered) throw new AppError("INVALID_STATE", "Não foi possível entregar a notificação (aparelho desconectado). Peça para ela reativar os lembretes.");
  return `Lembrete enviado para ${consultant.name.split(" ")[0]} (${pending} pendente${pending === 1 ? "" : "s"}).`;
}
