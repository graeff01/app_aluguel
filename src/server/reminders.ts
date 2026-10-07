/**
 * Lembretes diários de pendências (Web Push), enviados pelo worker.
 * - Consultora: quantas visitas dela aguardam resultado há mais de 24 h.
 * - Gestora: resumo da equipe por consultora.
 * Uma vez por pessoa por dia (ReminderLog único), a partir da hora configurada, exceto domingo.
 * Conteúdo: apenas contagens e nomes da equipe — nunca dados de clientes.
 */
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateOnlyKey, dayKey, startOfDayInTz, TZ } from "@/lib/time";
import { pushConfig, sendPush, type PushPayload, type PushTarget } from "@/lib/push";

export type Sender = (target: PushTarget, payload: PushPayload) => Promise<"ok" | "gone" | "error">;
import { log } from "@/lib/log";

const DAY = 86400_000;

function localHour(now: Date) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));
}
function localWeekday(now: Date) {
  const key = dayKey(now);
  return new Date(key + "T12:00:00Z").getUTCDay(); // 0 = domingo
}

async function deliver(userId: string, payload: PushPayload, send: Sender) {
  const subs = await db.pushSubscription.findMany({ where: { userId } });
  let delivered = 0;
  for (const s of subs) {
    const r = await send(s, payload);
    if (r === "ok") {
      delivered++;
      await db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } });
    } else if (r === "gone") {
      await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
    }
  }
  return delivered;
}

/** Garante envio único no dia: só quem cria o registro envia. */
async function claim(userId: string, day: string, kind: string, count: number) {
  try {
    const row = await db.reminderLog.create({ data: { userId, day, kind, count } });
    return row.id;
  } catch {
    return null; // já enviado hoje (ou outra réplica pegou)
  }
}

export async function sendDailyReminders(now = new Date(), opts: { force?: boolean; send?: Sender } = {}) {
  const send = opts.send ?? sendPush;
  if (!opts.send && !pushConfig()) return { skipped: "NO_VAPID" as const };
  const settings = await getSettings();
  if (!settings.remindersEnabled && !opts.force) return { skipped: "DISABLED" as const };
  if (!opts.force && (localHour(now) < settings.reminderHour || localWeekday(now) === 0)) return { skipped: "NOT_TIME" as const };

  const day = dayKey(now);
  const chargeStart = startOfDayInTz(dateOnlyKey(settings.resultsStartDate));
  const overdue = await db.visit.groupBy({
    by: ["consultantId"],
    where: { excluded: false, status: "SCHEDULED", consultantId: { not: null }, scheduledEnd: { lte: new Date(now.getTime() - DAY) }, scheduledStart: { gte: chargeStart } },
    _count: { _all: true },
  });
  const counts = new Map(overdue.map((o) => [o.consultantId!, o._count._all]));
  const users = await db.user.findMany({ where: { active: true, pushSubscriptions: { some: {} } }, select: { id: true, name: true, role: true } });
  const consultantNames = new Map((await db.user.findMany({ where: { role: "CONSULTANT" }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  let sent = 0;

  for (const u of users) {
    if (u.role === "CONSULTANT") {
      const n = counts.get(u.id) ?? 0;
      if (n === 0) continue;
      const id = await claim(u.id, day, "consultant_overdue", n);
      if (!id) continue;
      const delivered = await deliver(u.id, {
        title: n === 1 ? "1 visita aguardando resultado" : `${n} visitas aguardando resultado`,
        body: "Há mais de 24 h sem registro. Toque para registrar agora.",
        url: "/pendencias",
        tag: `pendencias-${day}`,
      }, send);
      await db.reminderLog.update({ where: { id }, data: { delivered } });
      sent += delivered;
    } else if (u.role === "MANAGER") {
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      if (total === 0) continue;
      const id = await claim(u.id, day, "manager_summary", total);
      if (!id) continue;
      const parts = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([cid, n]) => `${(consultantNames.get(cid) ?? "—").split(" ")[0]} ${n}`)
        .join(" · ");
      const delivered = await deliver(u.id, {
        title: `Equipe: ${total} ${total === 1 ? "visita" : "visitas"} sem registro há mais de 24 h`,
        body: parts,
        url: "/painel",
        tag: `resumo-${day}`,
      }, send);
      await db.reminderLog.update({ where: { id }, data: { delivered } });
      sent += delivered;
    }
  }
  log.info("reminders.sent", { day, notifications: sent });
  return { sent };
}
