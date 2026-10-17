/** Agenda do dia (somente leitura) para o pré-atendimento e a gestão: todas as consultoras, situação e confirmação. */
import { db } from "@/lib/db";
import { assert, hasGlobalView, isPreService, type AuthzActor } from "@/lib/authz";
import { dayKey, endOfDayInTz, startOfDayInTz } from "@/lib/time";

export async function dayAgenda(actor: AuthzActor, day: string) {
  assert(isPreService(actor) || hasGlobalView(actor));
  const visits = await db.visit.findMany({
    where: { excluded: false, scheduledStart: { gte: startOfDayInTz(day), lt: endOfDayInTz(day) } },
    orderBy: { scheduledStart: "asc" },
    select: {
      id: true,
      scheduledStart: true,
      scheduledEnd: true,
      clientName: true,
      propertyCode: true,
      status: true,
      evaluation: true,
      confirmStatus: true,
      assignmentNote: true,
      rescheduledFromId: true,
      consultantId: true,
      companionOfId: true,
      cancelReason: { select: { label: true } },
      note: true,
      autoCanceled: true,
      concludedBy: { select: { name: true } },
      consultant: { select: { name: true } },
      property: { select: { neighborhood: true } },
    },
  });
  const groups = new Map<string, { name: string; items: typeof visits }>();
  for (const v of visits) {
    const k = v.consultantId ?? "__none";
    const g = groups.get(k) ?? { name: v.consultant?.name ?? "Sem consultora", items: [] };
    g.items.push(v);
    groups.set(k, g);
  }
  const list = [...groups.entries()].map(([id, g]) => ({ id: id === "__none" ? null : id, ...g })).sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : a.name.localeCompare(b.name)));
  return { visits: visits.length, unassigned: groups.get("__none")?.items.length ?? 0, groups: list };
}

/** Semana ou mês: visitas agrupadas por dia (todas as consultoras). */
export async function rangeAgenda(actor: AuthzActor, fromDay: string, toDayExclusive: string) {
  assert(isPreService(actor) || hasGlobalView(actor));
  const visits = await db.visit.findMany({
    where: { excluded: false, scheduledStart: { gte: startOfDayInTz(fromDay), lt: startOfDayInTz(toDayExclusive) } },
    orderBy: { scheduledStart: "asc" },
    select: {
      id: true,
      scheduledStart: true,
      scheduledEnd: true,
      clientName: true,
      propertyCode: true,
      status: true,
      evaluation: true,
      confirmStatus: true,
      assignmentNote: true,
      rescheduledFromId: true,
      consultantId: true,
      companionOfId: true,
      cancelReason: { select: { label: true } },
      note: true,
      autoCanceled: true,
      concludedBy: { select: { name: true } },
      consultant: { select: { name: true } },
      property: { select: { neighborhood: true } },
    },
  });
  const days = new Map<string, typeof visits>();
  for (const v of visits) {
    const k = dayKey(v.scheduledStart);
    days.set(k, [...(days.get(k) ?? []), v]);
  }
  const byConsultant = new Map<string, number>();
  for (const v of visits) if (v.status !== "CANCELED") byConsultant.set(v.consultant?.name ?? "Sem consultora", (byConsultant.get(v.consultant?.name ?? "Sem consultora") ?? 0) + 1);
  return {
    total: visits.length,
    canceled: visits.filter((v) => v.status === "CANCELED").length,
    unassigned: visits.filter((v) => !v.consultantId && v.status === "SCHEDULED").length,
    byConsultant: [...byConsultant.entries()].sort((a, b) => b[1] - a[1]),
    days: [...days.entries()].map(([day, items]) => ({ day, items })),
  };
}
