/**
 * "Hoje ao vivo" (gestão): o dia de cada consultora agora — feitas, em andamento, sem resultado e próximas.
 * Só contagens, horários e imóveis na visão geral; nomes de clientes aparecem apenas na linha do tempo (gestão já tem acesso).
 */
import { db } from "@/lib/db";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { dateOnlyKey, dayKey, endOfDayInTz, startOfDayInTz } from "@/lib/time";
import { visitTone, type VisitToneKey } from "@/lib/visit-tone";

export type LiveState = "done" | "live" | "awaiting" | "overdue" | "upcoming" | "closed";

function stateOf(v: { status: string; evaluation: string | null; scheduledStart: Date; scheduledEnd: Date }, now: Date): LiveState {
  if (v.status === "SCHEDULED") {
    if (v.scheduledStart > now) return "upcoming";
    if (v.scheduledEnd > now) return "live";
    // terminou há mais de 2 h sem resultado: destaque mais forte
    return now.getTime() - v.scheduledEnd.getTime() > 2 * 3600_000 ? "overdue" : "awaiting";
  }
  return v.status === "DONE" || v.status === "NO_SHOW" ? "done" : "closed";
}

export async function liveBoard(actor: AuthzActor, now = new Date()) {
  assert(hasGlobalView(actor));
  const settings = await getSettings();
  const today = dayKey(now);
  const [consultants, visits, olderPending] = await Promise.all([
    db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true, _count: { select: { pushSubscriptions: true } } }, orderBy: { name: "asc" } }),
    db.visit.findMany({
      where: { excluded: false, scheduledStart: { gte: startOfDayInTz(today), lt: endOfDayInTz(today) } },
      orderBy: { scheduledStart: "asc" },
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        status: true,
        evaluation: true,
        clientName: true,
        propertyCode: true,
        consultantId: true,
        concludedAt: true,
        excluded: true,
        property: { select: { neighborhood: true, photoUrl: true } },
      },
    }),
    db.visit.groupBy({
      by: ["consultantId"],
      where: {
        excluded: false,
        status: "SCHEDULED",
        scheduledEnd: { lte: startOfDayInTz(today) },
        scheduledStart: { gte: startOfDayInTz(dateOnlyKey(settings.resultsStartDate)) },
      },
      _count: { _all: true },
    }),
  ]);
  const older = new Map(olderPending.map((o) => [o.consultantId, o._count._all]));

  const rows = [...consultants.map((c) => ({ id: c.id as string | null, name: c.name, push: c._count.pushSubscriptions > 0 })), { id: null, name: "Sem consultora", push: false }]
    .map((c) => {
      const mine = visits.filter((v) => v.consultantId === c.id).map((v) => ({ ...v, state: stateOf(v, now), tone: visitTone(v, now) as VisitToneKey }));
      const count = (s: LiveState) => mine.filter((v) => v.state === s).length;
      const lastConcluded = mine.reduce<Date | null>((a, v) => (v.concludedAt && (!a || v.concludedAt > a) ? v.concludedAt : a), null);
      const next = mine.find((v) => v.state === "upcoming") ?? null;
      const current = mine.find((v) => v.state === "live") ?? null;
      const positive = mine.filter((v) => v.status === "DONE" && v.evaluation === "POSITIVE").length;
      const done = count("done");
      const awaiting = count("awaiting") + count("overdue");
      return {
        ...c,
        visits: mine,
        total: mine.filter((v) => v.state !== "closed").length,
        done,
        live: count("live"),
        awaiting,
        overdue: count("overdue"),
        upcoming: count("upcoming"),
        closed: count("closed"),
        positive,
        olderPending: older.get(c.id) ?? 0,
        lastConcluded,
        next,
        current,
      };
    })
    .filter((r) => r.id !== null || r.visits.length > 0);

  const sum = (k: "total" | "done" | "live" | "awaiting" | "upcoming" | "positive" | "olderPending") => rows.reduce((a, r) => a + r[k], 0);
  return {
    today,
    rows,
    team: { total: sum("total"), done: sum("done"), live: sum("live"), awaiting: sum("awaiting"), upcoming: sum("upcoming"), positive: sum("positive"), olderPending: sum("olderPending") },
  };
}
