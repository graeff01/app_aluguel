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
import { notDemo } from "./demo";

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
    where: { ...notDemo, excluded: false, status: "SCHEDULED", consultantId: { not: null }, scheduledEnd: { lte: new Date(now.getTime() - DAY) }, scheduledStart: { gte: chargeStart } },
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
    where: { ...notDemo, scheduledStart: { gte: startOfDayInTz(from), lt: startOfDayInTz(today) } },
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

// ─────────────── Lembrete antes da visita (consultora) ───────────────

/**
 * Avisa a consultora N minutos antes de cada visita agendada (uma vez por visita).
 * Conteúdo: horário e código do imóvel — sem nome do cliente (aparece na tela bloqueada).
 */
export async function sendUpcomingVisitReminders(now = new Date(), opts: { send?: Sender; email?: EmailSender | null } = {}) {
  const send = opts.send ?? sendPush;
  const email = opts.email !== undefined ? opts.email : emailConfig() ? sendEmail : null;
  const pushOn = !!opts.send || !!pushConfig();
  if (!pushOn && !email) return { skipped: "NO_CHANNEL" as const };
  const settings = await getSettings();
  const minutes = settings.upcomingReminderMinutes;
  if (!settings.remindersEnabled || minutes <= 0) return { skipped: "DISABLED" as const };

  const visits = await db.visit.findMany({
    where: {
      ...notDemo,
      status: "SCHEDULED",
      excluded: false,
      consultantId: { not: null },
      consultant: { active: true },
      scheduledStart: { gt: now, lte: new Date(now.getTime() + minutes * 60_000) },
    },
    select: { id: true, scheduledStart: true, propertyCode: true, consultant: { select: { id: true, email: true, _count: { select: { pushSubscriptions: true } } } } },
  });
  const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  let sent = 0;
  for (const v of visits) {
    const c = v.consultant!;
    const id = await claim(c.id, dayKey(v.scheduledStart), `upcoming:${v.id}`, 1);
    if (!id) continue; // já lembrado
    const mins = Math.max(1, Math.round((v.scheduledStart.getTime() - now.getTime()) / 60_000));
    const delivered = await notify(
      { id: c.id, email: c.email, subs: pushOn ? c._count.pushSubscriptions : 0 },
      {
        title: `Visita às ${timeFmt.format(v.scheduledStart)}${v.propertyCode ? ` · imóvel ${v.propertyCode}` : ""}`,
        body: mins >= 60 ? `Começa em ${Math.round(mins / 60)} h. Toque para ver a ficha antes de entrar.` : `Começa em ${mins} min. Toque para ver a ficha antes de entrar.`,
        url: `/visitas/${v.id}/registrar`,
        tag: `visita-${v.id}`,
      },
      send,
      email,
    );
    await db.reminderLog.update({ where: { id }, data: { delivered } });
    sent += delivered;
  }
  if (sent) log.info("upcoming_reminders.sent", { notifications: sent });
  return { sent };
}

// ─────────────── Aviso do relatório mensal (gestão) ───────────────

/** Dia 1, a partir da hora configurada: avisa a gestão que o relatório do mês anterior está pronto. */
export async function sendMonthlyReportNotice(now = new Date(), opts: { send?: Sender; email?: EmailSender | null; force?: boolean } = {}) {
  const send = opts.send ?? sendPush;
  const email = opts.email !== undefined ? opts.email : emailConfig() ? sendEmail : null;
  const pushOn = !!opts.send || !!pushConfig();
  if (!pushOn && !email) return { skipped: "NO_CHANNEL" as const };
  const settings = await getSettings();
  const today = dayKey(now);
  if (!opts.force && (today.slice(8) !== "01" || localHour(now) < settings.reminderHour)) return { skipped: "NOT_TIME" as const };
  const [y, m] = today.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const label = names[Number(prev.slice(5)) - 1];
  const managers = await db.user.findMany({ where: { role: "MANAGER", active: true }, select: { id: true, email: true, _count: { select: { pushSubscriptions: true } } } });
  let sent = 0;
  for (const u of managers) {
    const id = await claim(u.id, today, `monthly_report:${prev}`, 1);
    if (!id) continue;
    const delivered = await notify({ id: u.id, email: u.email, subs: pushOn ? u._count.pushSubscriptions : 0 }, { title: `Relatório de ${label} pronto`, body: "Números da equipe, comparação entre consultoras e PDF para a direção.", url: `/relatorios?mes=${prev}`, tag: `relatorio-${prev}` }, send, email);
    await db.reminderLog.update({ where: { id }, data: { delivered } });
    sent += delivered;
  }
  return { sent };
}

// ─────────────── Resultado da visita: logo após o término, novo aviso e alerta à gestão ───────────────

const RESULT_SHORTCUTS = (visitId: string) => [
  { action: "positiva", title: "Gostou", url: `/visitas/${visitId}/registrar?r=POSITIVE` },
  { action: "negativa", title: "Não gostou", url: `/visitas/${visitId}/registrar?r=NEGATIVE` },
  { action: "faltou", title: "Não veio", url: `/visitas/${visitId}/registrar?r=NO_SHOW` },
];

/** Silêncio à noite para avisos que podem esperar (o "como foi?" imediato não entra aqui). */
function quietHours(now: Date) {
  const h = localHour(now);
  return h >= 21 || h < 8;
}

/**
 * 1) "Como foi a visita das 14:00?" até 1 h depois do término, com atalhos de resultado.
 * 2) Sem resultado após N h (resultReminderHours): novo aviso à consultora (uma vez).
 * 3) Sem resultado após N h (managerAlertHours): um aviso agrupado à gestão.
 * Uma vez por visita (ReminderLog). Conteúdo: horário e código do imóvel — sem dados do cliente.
 */
export async function sendResultReminders(now = new Date(), opts: { send?: Sender; email?: EmailSender | null } = {}) {
  const send = opts.send ?? sendPush;
  const email = opts.email !== undefined ? opts.email : emailConfig() ? sendEmail : null;
  const pushOn = !!opts.send || !!pushConfig();
  if (!pushOn && !email) return { skipped: "NO_CHANNEL" as const };
  const settings = await getSettings();
  if (!settings.remindersEnabled) return { skipped: "DISABLED" as const };
  const chargeStart = startOfDayInTz(dateOnlyKey(settings.resultsStartDate));
  const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const H = 3600_000;
  const select = {
    id: true,
    scheduledStart: true,
    scheduledEnd: true,
    propertyCode: true,
    consultantId: true,
    consultant: { select: { id: true, name: true, email: true, _count: { select: { pushSubscriptions: true } } } },
  } as const;
  const base = { ...notDemo, status: "SCHEDULED" as const, excluded: false, consultantId: { not: null }, consultant: { active: true }, scheduledStart: { gte: chargeStart } };
  const pendingFor = async (userId: string) =>
    db.visit.count({ where: { ...base, consultantId: userId, scheduledStart: { gte: chargeStart, lte: now } } });
  let sent = 0;

  // 1) logo após o término
  if (settings.resultPromptEnabled) {
    const just = await db.visit.findMany({ where: { ...base, scheduledEnd: { lte: now, gt: new Date(now.getTime() - H) } }, select });
    for (const v of just) {
      const c = v.consultant!;
      const id = await claim(c.id, dayKey(v.scheduledStart), `result_prompt:${v.id}`, 1);
      if (!id) continue;
      const delivered = await notify(
        { id: c.id, email: c.email, subs: pushOn ? c._count.pushSubscriptions : 0 },
        {
          title: `Como foi a visita das ${timeFmt.format(v.scheduledStart)}?`,
          body: `${v.propertyCode ? `Imóvel ${v.propertyCode}. ` : ""}Toque para registrar o resultado.`,
          url: `/visitas/${v.id}/registrar`,
          tag: `resultado-${v.id}`,
          actions: RESULT_SHORTCUTS(v.id),
          badge: await pendingFor(c.id),
        },
        send,
        email,
      );
      await db.reminderLog.update({ where: { id }, data: { delivered } });
      sent += delivered;
    }
  }

  if (quietHours(now)) return { sent };

  // 2) novo aviso à consultora
  if (settings.resultReminderHours > 0) {
    const late = await db.visit.findMany({
      where: { ...base, scheduledEnd: { lte: new Date(now.getTime() - settings.resultReminderHours * H), gt: new Date(now.getTime() - 20 * H) } },
      select,
    });
    for (const v of late) {
      const c = v.consultant!;
      const id = await claim(c.id, dayKey(v.scheduledStart), `result_reminder:${v.id}`, 1);
      if (!id) continue;
      const delivered = await notify(
        { id: c.id, email: c.email, subs: pushOn ? c._count.pushSubscriptions : 0 },
        {
          title: `Falta registrar a visita das ${timeFmt.format(v.scheduledStart)}`,
          body: `${v.propertyCode ? `Imóvel ${v.propertyCode}. ` : ""}Leva menos de um minuto — toque para registrar.`,
          url: `/visitas/${v.id}/registrar`,
          tag: `resultado-${v.id}`,
          actions: RESULT_SHORTCUTS(v.id),
          badge: await pendingFor(c.id),
        },
        send,
        email,
      );
      await db.reminderLog.update({ where: { id }, data: { delivered } });
      sent += delivered;
    }
  }

  // 3) alerta agrupado à gestão
  if (settings.managerAlertHours > 0) {
    const limit = settings.managerAlertHours * H;
    // janela larga o bastante para atravessar a noite silenciosa sem perder ninguém
    const stale = await db.visit.findMany({ where: { ...base, scheduledEnd: { lte: new Date(now.getTime() - limit), gt: new Date(now.getTime() - limit - 16 * H) } }, select });
    if (stale.length) {
      const managers = await db.user.findMany({ where: { role: "MANAGER", active: true }, select: { id: true, email: true, _count: { select: { pushSubscriptions: true } } } });
      for (const m of managers) {
        const fresh: typeof stale = [];
        for (const v of stale) if (await claim(m.id, dayKey(v.scheduledStart), `manager_late:${v.id}`, 1)) fresh.push(v);
        if (!fresh.length) continue;
        const per = new Map<string, number>();
        for (const v of fresh) per.set(v.consultant!.name.split(" ")[0], (per.get(v.consultant!.name.split(" ")[0]) ?? 0) + 1);
        const delivered = await notify(
          { id: m.id, email: m.email, subs: pushOn ? m._count.pushSubscriptions : 0 },
          {
            title: `${fresh.length === 1 ? "1 visita" : `${fresh.length} visitas`} sem resultado há mais de ${settings.managerAlertHours} h`,
            body: [...per.entries()].map(([n, k]) => `${n} ${k}`).join(" · "),
            url: "/ao-vivo",
            tag: `atrasadas-${dayKey(now)}`,
          },
          send,
          email,
        );
        sent += delivered;
      }
    }
  }
  if (sent) log.info("result_reminders.sent", { notifications: sent });
  return { sent };
}
