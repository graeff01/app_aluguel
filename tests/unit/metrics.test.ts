import { describe, expect, it } from "vitest";
import { computeMetrics, formatRate, type MetricOpportunity, type MetricVisit } from "@/lib/metrics";

// Conjunto conhecido (critério 10). Horários em UTC; São Paulo = UTC−3.
const T = (iso: string) => new Date(iso);
let n = 0;
function v(p: Partial<MetricVisit> & { start: string }): MetricVisit {
  const start = T(p.start);
  return {
    id: `v${++n}`,
    status: "SCHEDULED",
    evaluation: null,
    scheduledStart: start,
    scheduledEnd: new Date(start.getTime() + 3600_000),
    consultantId: "A",
    realizedById: null,
    propertyCode: "100",
    clientId: null,
    clientIdentity: null,
    clientMatch: null,
    negativeReasonId: null,
    excluded: false,
    ...p,
  };
}
const now = T("2026-10-20T15:00:00Z");
const params = { from: "2026-10-01", to: "2026-10-31", now, resultsStartDate: "2026-10-01" };

const visits: MetricVisit[] = [
  v({ start: "2026-10-05T13:00:00Z", status: "DONE", evaluation: "POSITIVE", realizedById: "A", clientId: "c1", clientIdentity: "CONFIRMED" }),
  v({ start: "2026-10-06T13:00:00Z", status: "DONE", evaluation: "POSITIVE", realizedById: "A", clientId: "c1", clientIdentity: "CONFIRMED" }),
  v({ start: "2026-10-07T13:00:00Z", status: "DONE", evaluation: "NEGATIVE", negativeReasonId: "preco", realizedById: "B", consultantId: "B", clientId: "c2", clientIdentity: "PENDING", propertyCode: "200" }),
  v({ start: "2026-10-08T13:00:00Z", status: "DONE", evaluation: "UNDECIDED", realizedById: "A", clientId: "c3", clientIdentity: "CONFIRMED", clientMatch: "SUGGESTED" }),
  v({ start: "2026-10-09T13:00:00Z", status: "NO_SHOW" }),
  v({ start: "2026-10-10T13:00:00Z", status: "CANCELED" }),
  v({ start: "2026-10-11T13:00:00Z", status: "RESCHEDULED" }),
  v({ start: "2026-10-12T13:00:00Z" }), // pendente > 24h
  v({ start: "2026-10-20T12:00:00Z" }), // terminou 13:00, pendente < 24h
  v({ start: "2026-10-25T13:00:00Z" }), // futura
  v({ start: "2026-09-30T13:00:00Z", status: "DONE", evaluation: "POSITIVE" }), // fora do período
  v({ start: "2026-10-13T13:00:00Z", excluded: true, status: "DONE", evaluation: "NEGATIVE", negativeReasonId: "preco" }),
  // 01/11 00:30 em SP = 31/10 ... cuidado com fuso: 2026-11-01T02:30Z = 31/10 23:30 em SP → dentro do período
  v({ start: "2026-11-01T02:30:00Z", status: "CANCELED" }),
];

const opp = (p: Partial<MetricOpportunity> & { first: string }): MetricOpportunity => ({
  id: `o${++n}`,
  status: "FOLLOW_UP",
  firstDoneVisitAt: T(p.first),
  closedAt: null,
  closedResponsibleId: null,
  responsibleId: "A",
  propertyCode: "100",
  lostAt: null,
  lostOrigin: null,
  lostReasonId: null,
  ...p,
});
const opps: MetricOpportunity[] = [
  opp({ first: "2026-10-05T13:00:00Z", status: "CLOSED_WON", closedAt: T("2026-11-03T00:00:00Z"), closedResponsibleId: "A" }), // coorte out, fechou em nov
  opp({ first: "2026-10-07T13:00:00Z", status: "LOST", lostOrigin: "VISIT_NEGATIVE", lostReasonId: "preco", lostAt: T("2026-10-07T14:00:00Z") }),
  opp({ first: "2026-10-08T13:00:00Z", status: "DOCS_REVIEW" }),
  opp({ first: "2026-09-10T13:00:00Z", status: "CLOSED_WON", closedAt: T("2026-10-15T00:00:00Z"), closedResponsibleId: "B" }), // fechou em out, coorte de set
  opp({ first: "2026-10-09T13:00:00Z", status: "LOST", lostOrigin: "LATER", lostReasonId: "desistiu", lostAt: T("2026-10-18T12:00:00Z") }),
];

describe("métricas (critério 10)", () => {
  const m = computeMetrics(visits, opps, params);

  it("conta situações separadamente e exclui visitas excluídas", () => {
    expect(m.totals).toMatchObject({ scheduled: 11, done: 4, noShow: 1, canceled: 2, rescheduled: 1, awaiting: 2, awaitingOver24h: 1, upcoming: 1 });
  });
  it("taxa de positivas = positivas / realizadas avaliadas", () => {
    expect(m.positiveRate).toEqual({ num: 2, den: 4, value: 0.5 });
  });
  it("não comparecimento = não compareceu / (realizadas + não compareceu)", () => {
    expect(m.noShowRate).toEqual({ num: 1, den: 5, value: 0.2 });
  });
  it("cobertura considera remarcadas como conclusão e mostra contagem à parte", () => {
    // encerradas elegíveis: 4 realizadas + no-show + 1 cancelada + remarcada + 2 pendentes = 9
    // (a cancelada de 31/10 ainda não terminou em 20/10, então fica fora do denominador)
    expect(m.coverage).toMatchObject({ num: 7, den: 9, rescheduled: 1 });
  });
  it("clientes distintos confirmados x identificação pendente", () => {
    expect(m.clients).toEqual({ confirmed: 1, pending: 2, withoutClient: 0 });
  });
  it("motivos de negativa separados de perdas posteriores", () => {
    expect(m.negativeReasons).toEqual([{ reasonId: "preco", count: 1, share: { num: 1, den: 1, value: 1 } }]);
    expect(m.lostReasons.map((r) => r.reasonId)).toEqual(["desistiu"]);
  });
  it("fechamentos pela data de fechamento, uma vez por oportunidade", () => {
    expect(m.closures.count).toBe(1);
  });
  it("coorte: fechadas até hoje / oportunidades com 1ª visita no período; mostra abertas", () => {
    // coorte out: 4 oportunidades; a fechada em 03/11 ainda não conta em 20/10
    expect(m.cohort).toMatchObject({ num: 0, den: 4, open: 1, lost: 2 });
    const later = computeMetrics(visits, opps, { ...params, now: T("2026-11-10T12:00:00Z") });
    expect(later.cohort).toMatchObject({ num: 1, den: 4 });
  });
  it("filtro por consultora usa quem realizou; fechamento usa responsável no fechamento", () => {
    const b = computeMetrics(visits, opps, { ...params, consultantId: "B" });
    expect(b.totals.done).toBe(1);
    expect(b.closures.count).toBe(1);
  });
  it("denominador zero → Sem base (não 0%)", () => {
    const empty = computeMetrics([], [], params);
    expect(empty.positiveRate.value).toBeNull();
    expect(formatRate(empty.positiveRate)).toBe("Sem base");
    expect(formatRate(empty.cohort)).toBe("Sem base");
  });
  it("agrupa por imóvel com volume junto da taxa", () => {
    const p200 = m.byProperty.find((r) => r.key === "200")!;
    expect(p200).toMatchObject({ total: 1, done: 1, negative: 1 });
    expect(p200.positiveRate.value).toBe(0);
  });
});
