/**
 * Relatório mensal para a direção: dados consolidados (equipe e por consultora) com comparações.
 * Puro em relação à apresentação — o PDF (report-pdf.tsx) e a prévia web usam a mesma estrutura.
 */
import { db } from "@/lib/db";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { addDays, dateOnlyKey, dayKey, endOfDayInTz, startOfDayInTz } from "@/lib/time";
import { computeMetrics, rate, type MetricOpportunity, type MetricVisit, type Rate } from "@/lib/metrics";
import { opportunityFunnel } from "./insights";

export const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(next, -1), label: `${MONTHS[m - 1]} de ${y}`, short: `${MONTHS[m - 1].slice(0, 3)}/${String(y).slice(2)}` };
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function isMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export type Kpis = {
  scheduled: number;
  done: number;
  noShow: number;
  canceled: number;
  rescheduled: number;
  awaiting: number;
  awaitingOver24h: number;
  positiveRate: Rate;
  noShowRate: Rate;
  coverage: Rate;
  closures: number;
  cohort: Rate & { open: number };
  clients: number;
};

function kpisOf(m: ReturnType<typeof computeMetrics>): Kpis {
  return {
    scheduled: m.totals.scheduled,
    done: m.totals.done,
    noShow: m.totals.noShow,
    canceled: m.totals.canceled,
    rescheduled: m.totals.rescheduled,
    awaiting: m.totals.awaiting,
    awaitingOver24h: m.totals.awaitingOver24h,
    positiveRate: m.positiveRate,
    noShowRate: m.noShowRate,
    coverage: m.coverage,
    closures: m.closures.count,
    cohort: { num: m.cohort.num, den: m.cohort.den, value: m.cohort.value, open: m.cohort.open },
    clients: m.clients.confirmed,
  };
}

export function pctText(r: Rate) {
  return r.value === null ? "Sem base" : `${(r.value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

const pct = (r: Rate) => (r.value === null ? null : Math.round(r.value * 1000) / 10);

export async function buildMonthlyReport(actor: AuthzActor, month: string, now = new Date()) {
  assert(hasGlobalView(actor));
  const settings = await getSettings();
  const cur = monthRange(month);
  const prev = monthRange(shiftMonth(month, -1));
  const seriesMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const seriesFrom = monthRange(seriesMonths[0]).from;
  const today = dayKey(now);
  const partial = cur.to >= today && cur.from <= today;

  const visitsRaw = await db.visit.findMany({
    where: { scheduledStart: { gte: startOfDayInTz(seriesFrom), lt: endOfDayInTz(cur.to) } },
    select: {
      id: true, status: true, evaluation: true, scheduledStart: true, scheduledEnd: true, consultantId: true, realizedById: true,
      propertyCode: true, clientId: true, clientMatch: true, negativeReasonId: true, excluded: true, origin: true, phoneNormalized: true,
      client: { select: { identityStatus: true } },
    },
  });
  const visits: (MetricVisit & { origin: string; phoneNormalized: string | null })[] = visitsRaw.map((v) => ({ ...v, clientIdentity: v.client?.identityStatus ?? null }));
  const oppsRaw = await db.opportunity.findMany({
    where: {
      OR: [
        { firstDoneVisitAt: { gte: startOfDayInTz(seriesFrom), lt: endOfDayInTz(cur.to) } },
        { closedAt: { gte: new Date(seriesFrom + "T00:00:00Z"), lte: new Date(cur.to + "T00:00:00Z") } },
        { lostAt: { gte: startOfDayInTz(seriesFrom), lt: endOfDayInTz(cur.to) } },
      ],
    },
    include: { property: { select: { code: true, title: true } } },
  });
  const opps: MetricOpportunity[] = oppsRaw.map((o) => ({ ...o, propertyCode: o.property.code }));
  const base = { now, resultsStartDate: dateOnlyKey(settings.resultsStartDate) };
  const metricsFor = (r: { from: string; to: string }, consultantId?: string | null) => computeMetrics(visits, opps, { ...base, from: r.from, to: r.to, consultantId });

  const team = metricsFor(cur);
  const teamPrev = metricsFor(prev);
  const reasons = await db.reason.findMany();
  const reasonName = new Map(reasons.map((r) => [r.id, r.label]));
  const consultants = await db.user.findMany({ where: { role: "CONSULTANT" }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } });

  // por consultora (somente quem teve visitas no mês ou está ativa)
  const perConsultant = consultants
    .map((c) => {
      const m = metricsFor(cur, c.id);
      const p = metricsFor(prev, c.id);
      const topReason = m.negativeReasons[0];
      return {
        id: c.id,
        name: c.name,
        active: c.active,
        kpis: kpisOf(m),
        prev: kpisOf(p),
        topReason: topReason ? { label: reasonName.get(topReason.reasonId) ?? "Sem motivo", count: topReason.count, share: topReason.share } : null,
        negativeReasons: m.negativeReasons.slice(0, 5).map((r) => ({ label: reasonName.get(r.reasonId) ?? "Sem motivo", count: r.count, share: r.share })),
        series: seriesMonths.map((mo) => {
          const mm = metricsFor(monthRange(mo), c.id);
          return { month: mo, label: monthRange(mo).short, done: mm.totals.done, positiveRate: mm.positiveRate, coverage: mm.coverage };
        }),
      };
    })
    .filter((c) => c.active || c.kpis.scheduled > 0);

  // série da equipe (6 meses)
  const series = seriesMonths.map((mo) => {
    const r = monthRange(mo);
    const m = metricsFor(r);
    return { month: mo, label: r.short, scheduled: m.totals.scheduled, done: m.totals.done, positive: m.evaluations.positive, positiveRate: m.positiveRate, noShowRate: m.noShowRate, coverage: m.coverage, closures: m.closures.count };
  });

  // imóveis (mês)
  const titleOf = new Map(oppsRaw.map((o) => [o.property.code, o.property.title]));
  const propRows = team.byProperty.filter((p) => p.key !== "—");
  const propsMore = await db.property.findMany({ where: { code: { in: propRows.map((p) => p.key) } }, select: { code: true, title: true } });
  for (const p of propsMore) titleOf.set(p.code, p.title);
  const topProperties = propRows.slice(0, 10).map((p) => ({ ...p, title: titleOf.get(p.key) ?? null }));
  const mostRejected = [...propRows].filter((p) => p.negative > 0).sort((a, b) => b.negative - a.negative || b.total - a.total).slice(0, 5).map((p) => ({ ...p, title: titleOf.get(p.key) ?? null }));

  // qualidade dos dados (mês)
  const monthVisits = visits.filter((v) => !v.excluded && dayKey(v.scheduledStart) >= cur.from && dayKey(v.scheduledStart) <= cur.to);
  const quality = {
    total: monthVisits.length,
    withPhone: rate(monthVisits.filter((v) => v.phoneNormalized).length, monthVisits.length),
    withCode: rate(monthVisits.filter((v) => v.propertyCode).length, monthVisits.length),
    fromCalendar: rate(monthVisits.filter((v) => v.origin === "GOOGLE").length, monthVisits.length),
    pendingIdentity: team.clients.pending,
  };

  const funnel = await opportunityFunnel(actor, { from: cur.from, to: cur.to });

  // destaques automáticos (texto determinístico)
  const highlights: { tone: "good" | "bad" | "neutral"; text: string }[] = [];
  const delta = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));
  const dDone = delta(team.totals.done, teamPrev.totals.done);
  if (dDone !== null && dDone !== 0) highlights.push({ tone: dDone > 0 ? "good" : "bad", text: `Visitas realizadas ${dDone > 0 ? "cresceram" : "caíram"} ${Math.abs(dDone)}% em relação a ${prev.label.split(" ")[0]} (de ${teamPrev.totals.done} para ${team.totals.done}).` });
  const pPos = pct(team.positiveRate);
  const pPosPrev = pct(teamPrev.positiveRate);
  if (pPos !== null && pPosPrev !== null) {
    const d = Math.round((pPos - pPosPrev) * 10) / 10;
    highlights.push({ tone: d > 0 ? "good" : d < 0 ? "bad" : "neutral", text: `Taxa de positivas em ${pPos.toLocaleString("pt-BR")}% (${d >= 0 ? "+" : ""}${d.toLocaleString("pt-BR")} p.p. vs mês anterior).` });
  }
  const pCov = pct(team.coverage);
  if (pCov !== null) highlights.push({ tone: pCov >= settings.coverageGoal ? "good" : "bad", text: `Cobertura de registro em ${pCov.toLocaleString("pt-BR")}% — meta de ${settings.coverageGoal}% ${pCov >= settings.coverageGoal ? "atingida" : "não atingida"}.` });
  const ranked = perConsultant.filter((c) => c.kpis.positiveRate.den >= 5).sort((a, b) => (b.kpis.positiveRate.value ?? 0) - (a.kpis.positiveRate.value ?? 0));
  if (ranked.length >= 2) highlights.push({ tone: "neutral", text: `Maior taxa de positivas: ${ranked[0].name.split(" ")[0]} (${pct(ranked[0].kpis.positiveRate)?.toLocaleString("pt-BR")}% em ${ranked[0].kpis.positiveRate.den} visitas).` });
  const top = team.negativeReasons[0];
  if (top && team.evaluations.negative >= 3) highlights.push({ tone: "neutral", text: `Principal motivo de recusa: ${reasonName.get(top.reasonId) ?? "sem motivo"} (${Math.round((top.share.value ?? 0) * 100)}% das negativas).` });
  if (team.closures.count) highlights.push({ tone: "good", text: `${team.closures.count} ${team.closures.count === 1 ? "locação fechada" : "locações fechadas"} no mês.` });
  if (team.totals.awaitingOver24h) highlights.push({ tone: "bad", text: `${team.totals.awaitingOver24h} ${team.totals.awaitingOver24h === 1 ? "visita segue" : "visitas seguem"} sem registro há mais de 24 h.` });
  if (!highlights.length) highlights.push({ tone: "neutral", text: "Sem movimento suficiente no período para destaques." });

  return {
    month,
    label: cur.label,
    prevLabel: prev.label,
    from: cur.from,
    to: cur.to,
    partial,
    generatedAt: now,
    goal: settings.coverageGoal,
    team: kpisOf(team),
    teamPrev: kpisOf(teamPrev),
    evaluations: team.evaluations,
    negativeReasons: team.negativeReasons.slice(0, 8).map((r) => ({ label: reasonName.get(r.reasonId) ?? "Sem motivo", count: r.count, share: r.share })),
    lostReasons: team.lostReasons.slice(0, 6).map((r) => ({ label: reasonName.get(r.reasonId) ?? "Sem motivo", count: r.count, share: r.share })),
    perConsultant,
    series,
    topProperties,
    mostRejected,
    quality,
    funnel,
    highlights,
  };
}

export type MonthlyReport = Awaited<ReturnType<typeof buildMonthlyReport>>;
