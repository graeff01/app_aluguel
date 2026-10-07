/**
 * Indicadores — funções puras sobre registros já autorizados.
 * Definições (também exibidas na tela do painel):
 *
 * - Período de visitas: data de início da visita no fuso operacional.
 * - Atribuição de visita: consultora responsável na realização (realizedById); se ainda não realizada, a responsável atual.
 * - Taxa de positivas = positivas / realizadas com avaliação registrada.
 * - Taxa de não comparecimento = não compareceu / (realizadas + não compareceu).
 * - Cobertura de registro = compromissos elegíveis encerrados com conclusão / compromissos elegíveis encerrados,
 *   a partir da data inicial de cobrança. "Remarcada" é uma conclusão registrada (conta no numerador e denominador)
 *   e sua contagem aparece à parte. Cancelamentos automáticos vindos do Google contam como concluídos.
 * - Fechamentos: data do fechamento, uma vez por oportunidade, atribuídos à responsável registrada no fechamento.
 * - Conversão por coorte: oportunidades com primeira visita realizada no período que chegaram a locação fechada
 *   até a data da consulta / total dessas oportunidades.
 * - Denominador zero → null ("Sem base").
 */
import { dayKey, dateOnlyKey } from "./time";

export type MetricVisit = {
  id: string;
  status: "SCHEDULED" | "DONE" | "NO_SHOW" | "CANCELED" | "RESCHEDULED";
  evaluation: "POSITIVE" | "NEGATIVE" | "UNDECIDED" | null;
  scheduledStart: Date;
  scheduledEnd: Date;
  consultantId: string | null;
  realizedById: string | null;
  propertyCode: string | null;
  clientId: string | null;
  clientIdentity: "CONFIRMED" | "PENDING" | null;
  clientMatch: string | null;
  negativeReasonId: string | null;
  excluded: boolean;
};

export type MetricOpportunity = {
  id: string;
  status: "FOLLOW_UP" | "DOCS_REVIEW" | "CLOSED_WON" | "LOST";
  firstDoneVisitAt: Date;
  closedAt: Date | null; // @db.Date
  closedResponsibleId: string | null;
  responsibleId: string | null;
  propertyCode: string;
  lostAt: Date | null;
  lostOrigin: "VISIT_NEGATIVE" | "LATER" | null;
  lostReasonId: string | null;
};

export type MetricParams = {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  now: Date;
  resultsStartDate: string; // YYYY-MM-DD
  consultantId?: string | null;
  propertyCode?: string | null;
};

export type Rate = { num: number; den: number; value: number | null };

export function rate(num: number, den: number): Rate {
  return { num, den, value: den > 0 ? num / den : null };
}

export function formatRate(r: Rate): string {
  if (r.value === null) return "Sem base";
  return `${(r.value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

type GroupRow = {
  key: string;
  total: number;
  done: number;
  noShow: number;
  canceled: number;
  rescheduled: number;
  pending: number;
  positive: number;
  negative: number;
  undecided: number;
  positiveRate: Rate;
};

export type Metrics = ReturnType<typeof computeMetrics>;

const inRange = (k: string, from: string, to: string) => k >= from && k <= to;
const HOUR = 3600_000;

export function visitAttribution(v: Pick<MetricVisit, "realizedById" | "consultantId">) {
  return v.realizedById ?? v.consultantId;
}

export function computeMetrics(visitsAll: MetricVisit[], oppsAll: MetricOpportunity[], p: MetricParams) {
  const visits = visitsAll.filter((v) => {
    if (v.excluded) return false;
    if (!inRange(dayKey(v.scheduledStart), p.from, p.to)) return false;
    if (p.consultantId && visitAttribution(v) !== p.consultantId) return false;
    if (p.propertyCode && v.propertyCode !== p.propertyCode) return false;
    return true;
  });

  const nowMs = p.now.getTime();
  const isCharged = (v: MetricVisit) => dayKey(v.scheduledStart) >= p.resultsStartDate;
  const ended = (v: MetricVisit) => v.scheduledEnd.getTime() <= nowMs;

  const count = (pred: (v: MetricVisit) => boolean) => visits.filter(pred).length;
  const done = visits.filter((v) => v.status === "DONE");
  const positive = done.filter((v) => v.evaluation === "POSITIVE").length;
  const negative = done.filter((v) => v.evaluation === "NEGATIVE").length;
  const undecided = done.filter((v) => v.evaluation === "UNDECIDED").length;
  const noShow = count((v) => v.status === "NO_SHOW");

  const awaiting = visits.filter((v) => v.status === "SCHEDULED" && ended(v) && isCharged(v));
  const awaitingOver24h = awaiting.filter((v) => nowMs - v.scheduledEnd.getTime() > 24 * HOUR).length;
  const notChargedOpen = count((v) => v.status === "SCHEDULED" && ended(v) && !isCharged(v));
  const upcoming = count((v) => v.status === "SCHEDULED" && !ended(v));

  const eligibleEnded = visits.filter((v) => ended(v) && isCharged(v));
  const eligibleConcluded = eligibleEnded.filter((v) => v.status !== "SCHEDULED");
  const rescheduledEligible = eligibleConcluded.filter((v) => v.status === "RESCHEDULED").length;

  // Clientes distintos atendidos (visitas realizadas)
  const confirmedClients = new Set<string>();
  const pendingClients = new Set<string>();
  let doneWithoutClient = 0;
  for (const v of done) {
    if (!v.clientId) {
      doneWithoutClient++;
      continue;
    }
    if (v.clientIdentity === "CONFIRMED" && v.clientMatch !== "SUGGESTED") confirmedClients.add(v.clientId);
    else pendingClients.add(v.clientId);
  }

  // Motivos de visitas negativas
  const reasonCounts = new Map<string, number>();
  for (const v of done) {
    if (v.evaluation !== "NEGATIVE") continue;
    const k = v.negativeReasonId ?? "sem-motivo";
    reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
  }
  const negativeReasons = [...reasonCounts.entries()]
    .map(([reasonId, n]) => ({ reasonId, count: n, share: rate(n, negative) }))
    .sort((a, b) => b.count - a.count);

  // Agrupamentos (volume junto das taxas)
  const group = (keyOf: (v: MetricVisit) => string | null): GroupRow[] => {
    const map = new Map<string, MetricVisit[]>();
    for (const v of visits) {
      const k = keyOf(v) ?? "—";
      map.set(k, [...(map.get(k) ?? []), v]);
    }
    return [...map.entries()]
      .map(([key, vs]) => {
        const d = vs.filter((v) => v.status === "DONE");
        const pos = d.filter((v) => v.evaluation === "POSITIVE").length;
        return {
          key,
          total: vs.length,
          done: d.length,
          noShow: vs.filter((v) => v.status === "NO_SHOW").length,
          canceled: vs.filter((v) => v.status === "CANCELED").length,
          rescheduled: vs.filter((v) => v.status === "RESCHEDULED").length,
          pending: vs.filter((v) => v.status === "SCHEDULED" && ended(v) && isCharged(v)).length,
          positive: pos,
          negative: d.filter((v) => v.evaluation === "NEGATIVE").length,
          undecided: d.filter((v) => v.evaluation === "UNDECIDED").length,
          positiveRate: rate(pos, d.length),
        };
      })
      .sort((a, b) => b.total - a.total);
  };

  // Oportunidades
  const opps = oppsAll.filter((o) => (p.propertyCode ? o.propertyCode === p.propertyCode : true));
  const closures = opps.filter(
    (o) =>
      o.status === "CLOSED_WON" &&
      o.closedAt &&
      inRange(dateOnlyKey(o.closedAt), p.from, p.to) &&
      (!p.consultantId || o.closedResponsibleId === p.consultantId),
  );
  const todayKey = dayKey(p.now);
  const cohort = opps.filter(
    (o) => inRange(dayKey(o.firstDoneVisitAt), p.from, p.to) && (!p.consultantId || o.responsibleId === p.consultantId),
  );
  const cohortClosed = cohort.filter((o) => o.status === "CLOSED_WON" && o.closedAt && dateOnlyKey(o.closedAt) <= todayKey);
  const cohortOpen = cohort.filter((o) => o.status === "FOLLOW_UP" || o.status === "DOCS_REVIEW").length;
  const cohortLost = cohort.filter((o) => o.status === "LOST").length;

  const lostLater = opps.filter(
    (o) =>
      o.status === "LOST" &&
      o.lostOrigin === "LATER" &&
      o.lostAt &&
      inRange(dayKey(o.lostAt), p.from, p.to) &&
      (!p.consultantId || o.responsibleId === p.consultantId),
  );
  const lostReasonCounts = new Map<string, number>();
  for (const o of lostLater) {
    const k = o.lostReasonId ?? "sem-motivo";
    lostReasonCounts.set(k, (lostReasonCounts.get(k) ?? 0) + 1);
  }
  const lostReasons = [...lostReasonCounts.entries()]
    .map(([reasonId, n]) => ({ reasonId, count: n, share: rate(n, lostLater.length) }))
    .sort((a, b) => b.count - a.count);

  const openOpportunities = opps.filter(
    (o) => (o.status === "FOLLOW_UP" || o.status === "DOCS_REVIEW") && (!p.consultantId || o.responsibleId === p.consultantId),
  );

  return {
    totals: {
      scheduled: visits.length,
      done: done.length,
      noShow,
      canceled: count((v) => v.status === "CANCELED"),
      rescheduled: count((v) => v.status === "RESCHEDULED"),
      upcoming,
      awaiting: awaiting.length,
      awaitingOver24h,
      notChargedOpen,
    },
    evaluations: { positive, negative, undecided, evaluated: done.length },
    positiveRate: rate(positive, done.length),
    noShowRate: rate(noShow, done.length + noShow),
    coverage: { ...rate(eligibleConcluded.length, eligibleEnded.length), rescheduled: rescheduledEligible },
    clients: { confirmed: confirmedClients.size, pending: pendingClients.size, withoutClient: doneWithoutClient },
    negativeReasons,
    lostReasons,
    byConsultant: group((v) => visitAttribution(v)),
    byProperty: group((v) => v.propertyCode),
    closures: { count: closures.length, ids: closures.map((o) => o.id) },
    cohort: {
      ...rate(cohortClosed.length, cohort.length),
      open: cohortOpen,
      lost: cohortLost,
      ids: cohort.map((o) => o.id),
    },
    openOpportunities: {
      followUp: openOpportunities.filter((o) => o.status === "FOLLOW_UP").length,
      docsReview: openOpportunities.filter((o) => o.status === "DOCS_REVIEW").length,
    },
    visitIds: visits.map((v) => v.id),
  };
}
