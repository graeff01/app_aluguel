/** Painel da gestão: o trabalho do pré-atendimento no período (visitas que ela agendou e pré-análises enviadas). */
import { db } from "@/lib/db";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { addDays, startOfDayInTz } from "@/lib/time";
import { preAnalysisStats } from "@/server/pre-analysis";

type Count = { total: number; done: number; noShow: number; canceled: number };
const bump = (m: Map<string, Count>, k: string, status: string) => {
  const c = m.get(k) ?? { total: 0, done: 0, noShow: 0, canceled: 0 };
  c.total++;
  if (status === "DONE") c.done++;
  if (status === "NO_SHOW") c.noShow++;
  if (status === "CANCELED") c.canceled++;
  m.set(k, c);
};

export async function preServiceDashboard(actor: AuthzActor, userId: string, from: string, to: string, now = new Date()) {
  assert(hasGlobalView(actor));
  const user = await db.user.findFirst({ where: { id: userId, role: "PRE_SERVICE" }, select: { id: true, name: true, email: true, aliases: { select: { email: true } } } });
  if (!user) return null;
  // visitas dela = eventos que ela organizou na agenda Google (e-mail de login + e-mails cadastrados como apelido)
  const emails = [...new Set([user.email, ...user.aliases.map((a) => a.email)].map((e) => e.toLowerCase()))];
  const start = startOfDayInTz(from);
  const end = startOfDayInTz(addDays(to, 1));
  const byOrganizer = { sourceEvent: { organizerEmail: { in: emails } } };
  const [visits, pre] = await Promise.all([
    db.visit.findMany({
      where: { excluded: false, scheduledStart: { gte: start, lt: end }, OR: [byOrganizer, { companionOf: byOrganizer }] },
      select: { status: true, evaluation: true, scheduledEnd: true, companionOfId: true, autoCanceled: true, cancelReason: { select: { label: true } }, consultant: { select: { name: true } } },
    }),
    preAnalysisStats(actor, start, end, { senderId: user.id }),
  ]);
  const count = (s: string) => visits.filter((v) => v.status === s).length;
  const done = count("DONE");
  const noShow = count("NO_SHOW");
  const byConsultant = new Map<string, Count>();
  const cancelReasons = new Map<string, number>();
  for (const v of visits) {
    bump(byConsultant, v.consultant?.name ?? "Sem consultora", v.status);
    if (v.status === "CANCELED") {
      const k = v.cancelReason?.label ?? (v.autoCanceled ? "Pela agenda Google (sem motivo)" : "Sem motivo informado");
      cancelReasons.set(k, (cancelReasons.get(k) ?? 0) + 1);
    }
  }
  return {
    user: { id: user.id, name: user.name },
    emails,
    visits: {
      total: visits.length,
      clients: visits.filter((v) => !v.companionOfId).length,
      done,
      positive: visits.filter((v) => v.status === "DONE" && v.evaluation === "POSITIVE").length,
      noShow,
      canceled: count("CANCELED"),
      rescheduled: count("RESCHEDULED"),
      upcoming: visits.filter((v) => v.status === "SCHEDULED" && v.scheduledEnd > now).length,
      awaiting: visits.filter((v) => v.status === "SCHEDULED" && v.scheduledEnd <= now).length,
      attendance: done + noShow ? done / (done + noShow) : null,
    },
    byConsultant: [...byConsultant.entries()].sort((a, b) => b[1].total - a[1].total),
    cancelReasons: [...cancelReasons.entries()].sort((a, b) => b[1] - a[1]),
    pre,
  };
}
