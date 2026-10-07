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
import { computeMetrics } from "@/lib/metrics";
import { appLink, emailConfig, sendEmail, type EmailSender } from "@/lib/email";

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

type Recipient = { id: string; email: string; subs: number };

/** Celular quando houver inscrição; senão e-mail (se configurado). Retorna quantas entregas ocorreram. */
async function notify(u: Recipient, payload: PushPayload, send: Sender, email: EmailSender | null) {
  if (u.subs > 0) return deliver(u.id, payload, send);
  if (email) return (await email(u.email, payload.title, `${payload.body}\n\nAbrir o app: ${appLink(payload.url)}\n\n— Visitas Locação (mensagem automática; não responda)`)) ? 1 : 0;
  return 0;
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

export async function sendDailyReminders(now = new Date(), opts: { force?: boolean; send?: Sender; email?: EmailSender | null } = {}) {
  const send = opts.send ?? sendPush;
  const email = opts.email !== undefined ? opts.email : emailConfig() ? sendEmail : null;
  const pushOn = !!opts.send || !!pushConfig();
  if (!pushOn && !email) return { skipped: "NO_VAPID" as const };
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
  const users = (
    await db.user.findMany({
      where: { active: true, role: { in: ["CONSULTANT", "MANAGER"] }, ...(email ? {} : { pushSubscriptions: { some: {} } }) },
      select: { id: true, name: true, role: true, email: true, _count: { select: { pushSubscriptions: true } } },
    })
  ).map((u) => ({ ...u, subs: pushOn ? u._count.pushSubscriptions : 0 }));
  const consultantNames = new Map((await db.user.findMany({ where: { role: "CONSULTANT" }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  let sent = 0;

  for (const u of users) {
    if (u.role === "CONSULTANT") {
      const n = counts.get(u.id) ?? 0;
      if (n === 0) continue;
      const id = await claim(u.id, day, "consultant_overdue", n);
      if (!id) continue;
      const delivered = await notify(u, {
        title: n === 1 ? "1 visita aguardando resultado" : `${n} visitas aguardando resultado`,
        body: "Há mais de 24 h sem registro. Toque para registrar agora.",
        url: "/minhas",
        tag: `pendencias-${day}`,
      }, send, email);
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
      const delivered = await notify(u, {
        title: `Equipe: ${total} ${total === 1 ? "visita" : "visitas"} sem registro há mais de 24 h`,
        body: parts,
        url: "/painel",
        tag: `resumo-${day}`,
      }, send, email);
      await db.reminderLog.update({ where: { id }, data: { delivered } });
      sent += delivered;
    }
  }
  log.info("reminders.sent", { day, notifications: sent });
  return { sent };
}

// ─────────────── Resumo semanal (gestão) ───────────────

/** Toda segunda-feira, a partir da hora configurada: números da semana anterior (equipe). */
export async function sendWeeklySummary(now = new Date(), opts: { force?: boolean; send?: Sender; email?: EmailSender | null } = {}) {
  const send = opts.send ?? sendPush;
  const email = opts.email !== undefined ? opts.email : emailConfig() ? sendEmail : null;
  const pushOn = !!opts.send || !!pushConfig();
  if (!pushOn && !email) return { skipped: "NO_VAPID" as const };
  const settings = await getSettings();
  if (!settings.remindersEnabled && !opts.force) return { skipped: "DISABLED" as const };
  if (!opts.force && (localWeekday(now) !== 1 || localHour(now) < settings.reminderHour)) return { skipped: "NOT_TIME" as const };

  const today = dayKey(now);
  const from = addDaysKey(today, -7);
  const to = addDaysKey(today, -1);
  const managers = (
    await db.user.findMany({
      where: { role: "MANAGER", active: true, ...(email ? {} : { pushSubscriptions: { some: {} } }) },
      select: { id: true, email: true, _count: { select: { pushSubscriptions: true } } },
    })
  ).map((u) => ({ ...u, subs: pushOn ? u._count.pushSubscriptions : 0 }));
  if (managers.length === 0) return { sent: 0 };

  const visits = await db.visit.findMany({
    where: { scheduledStart: { gte: startOfDayInTz(from), lt: startOfDayInTz(today) } },
    select: { id: true, status: true, evaluation: true, scheduledStart: true, scheduledEnd: true, consultantId: true, realizedById: true, propertyCode: true, clientId: true, clientMatch: true, negativeReasonId: true, excluded: true },
  });
  const opps = await db.opportunity.findMany({
    where: { OR: [{ closedAt: { gte: new Date(from + "T00:00:00Z"), lte: new Date(to + "T00:00:00Z") } }, { firstDoneVisitAt: { gte: startOfDayInTz(from) } }] },
    include: { property: { select: { code: true } } },
  });
  const m = computeMetrics(
    visits.map((v) => ({ ...v, clientIdentity: null })),
    opps.map((o) => ({ ...o, propertyCode: o.property.code })),
    { from, to, now, resultsStartDate: dateOnlyKey(settings.resultsStartDate) },
  );
  const pct = (r: { value: number | null }) => (r.value === null ? "sem base" : `${Math.round(r.value * 100)}%`);
  const payload = {
    title: `Semana passada: ${m.totals.done} ${m.totals.done === 1 ? "visita realizada" : "visitas realizadas"}`,
    body: `Positivas ${pct(m.positiveRate)} · cobertura ${pct(m.coverage)} · ${m.closures.count} ${m.closures.count === 1 ? "locação fechada" : "locações fechadas"} · ${m.totals.awaiting} sem registro`,
    url: `/painel?de=${from}&ate=${to}`,
    tag: `semana-${today}`,
  };
  let sent = 0;
  for (const u of managers) {
    const id = await claim(u.id, today, "weekly_summary", m.totals.done);
    if (!id) continue;
    const delivered = await notify(u, payload, send, email);
    await db.reminderLog.update({ where: { id }, data: { delivered } });
    sent += delivered;
  }
  log.info("weekly_summary.sent", { notifications: sent });
  return { sent };
}

function addDaysKey(key: string, n: number) {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}
