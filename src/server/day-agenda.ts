/** Agenda do dia (somente leitura) para o pré-atendimento e a gestão: todas as consultoras, situação e confirmação. */
import { db } from "@/lib/db";
import { assert, hasGlobalView, isPreService, type AuthzActor } from "@/lib/authz";
import { endOfDayInTz, startOfDayInTz } from "@/lib/time";

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
