/**
 * Mapa da demanda: o que os clientes procuram e não encontram (Radar do pré-atendimento + Clientes em busca das
 * consultoras), cruzado com a oferta que existe hoje no site da imobiliária. Orienta onde a captação deve buscar.
 * Só perfis (bairro, tipo, quartos, valor) — nenhum dado de cliente aparece aqui.
 */
import { db } from "@/lib/db";
import { assert, hasGlobalView, isCapture, type AuthzActor } from "@/lib/authz";
import { RADAR_CLOSE_REASONS } from "./radar";
import { countOnSite, normText, profileQuery, siteOrigin, siteSearchUrl } from "./site-search";

const DAY = 86400_000;
/** Mapa da demanda e pedidos: captação e gestão (o pré-atendimento e as consultoras não precisam). */
export const canSeeDemand = (a: AuthzActor) => isCapture(a) || hasGlobalView(a);

export const BUDGET_BUCKETS = [
  { label: "até R$ 1.500", max: 150000 },
  { label: "R$ 1.500 a 2.000", max: 200000 },
  { label: "R$ 2.000 a 2.500", max: 250000 },
  { label: "R$ 2.500 a 3.000", max: 300000 },
  { label: "R$ 3.000 a 4.000", max: 400000 },
  { label: "acima de R$ 4.000", max: Infinity },
] as const;

type Row = { source: "radar" | "busca"; areas: string[]; propertyType: string | null; bedrooms: number | null; maxBudgetCents: number | null; open: boolean };
type Count = { label: string; count: number };

const titleCase = (s: string) => s.replace(/\s+/g, " ").trim().replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());

function tally(values: string[]): Count[] {
  const m = new Map<string, { label: string; count: number }>();
  for (const v of values) {
    const k = normText(v);
    if (!k) continue;
    const cur = m.get(k) ?? { label: titleCase(v), count: 0 };
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const mode = (xs: number[]) => {
  if (!xs.length) return null;
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
};

/** Demanda do período: pedidos do radar criados e buscas iniciadas nos últimos `days` dias (mais os que seguem abertos). */
export async function demandMap(actor: AuthzActor, f: { days: number }, now = new Date()) {
  assert(canSeeDemand(actor));
  const since = new Date(now.getTime() - f.days * DAY);
  const [radars, searches, radarClosed] = await Promise.all([
    db.clientRadar.findMany({ where: { OR: [{ createdAt: { gte: since } }, { status: { in: ["SEARCHING", "FOUND"] } }] }, select: { areas: true, propertyType: true, bedrooms: true, maxBudgetCents: true, status: true, createdAt: true } }),
    db.clientSearch.findMany({ where: { OR: [{ startedAt: { gte: since } }, { status: "ACTIVE" }] }, select: { areas: true, propertyType: true, bedrooms: true, maxBudgetCents: true, status: true } }),
    db.clientRadar.findMany({ where: { status: "CLOSED", closedAt: { gte: since } }, select: { closeReason: true, createdAt: true, closedAt: true, foundCodes: true } }),
  ]);
  const rows: Row[] = [
    ...radars.map((r) => ({ source: "radar" as const, areas: r.areas, propertyType: r.propertyType, bedrooms: r.bedrooms, maxBudgetCents: r.maxBudgetCents, open: r.status !== "CLOSED" })),
    ...searches.map((s) => ({ source: "busca" as const, areas: s.areas, propertyType: s.propertyType, bedrooms: s.bedrooms, maxBudgetCents: s.maxBudgetCents, open: s.status === "ACTIVE" })),
  ];

  const byArea = tally(rows.flatMap((r) => [...new Set(r.areas.map((a) => a.trim()))]));
  const byType = tally(rows.map((r) => r.propertyType ?? "")).concat(rows.some((r) => !r.propertyType) ? [{ label: "Qualquer tipo", count: rows.filter((r) => !r.propertyType).length }] : []);
  const bedroomLabel = (n: number | null) => (n == null ? null : n >= 4 ? "4 ou mais" : `${n} quarto${n === 1 ? "" : "s"}`);
  const byBedrooms = ["1 quarto", "2 quartos", "3 quartos", "4 ou mais"].map((label) => ({ label, count: rows.filter((r) => bedroomLabel(r.bedrooms) === label).length }));
  const byBudget = BUDGET_BUCKETS.map((b, i) => ({ label: b.label, count: rows.filter((r) => r.maxBudgetCents != null && r.maxBudgetCents <= b.max && (i === 0 || r.maxBudgetCents > BUDGET_BUCKETS[i - 1].max)).length }));

  // segmentos: bairro + tipo (o que mais se repete), com os quartos mais pedidos e o valor do meio
  const seg = new Map<string, { area: string; type: string | null; rows: Row[] }>();
  for (const r of rows)
    for (const a of new Set(r.areas.map((x) => x.trim()).filter(Boolean))) {
      const k = `${normText(a)}|${r.propertyType ?? ""}`;
      const cur = seg.get(k) ?? { area: titleCase(a), type: r.propertyType, rows: [] };
      cur.rows.push(r);
      seg.set(k, cur);
    }
  const segments = [...seg.values()]
    .map((s) => ({
      area: s.area,
      type: s.type,
      demand: s.rows.length,
      open: s.rows.filter((r) => r.open).length,
      bedrooms: mode(s.rows.map((r) => r.bedrooms).filter((x): x is number => x != null)),
      budgetCents: median(s.rows.map((r) => r.maxBudgetCents).filter((x): x is number => x != null)),
    }))
    .sort((a, b) => b.demand - a.demand || b.open - a.open || a.area.localeCompare(b.area) || (a.type ?? "").localeCompare(b.type ?? ""))
    .slice(0, 8);

  // captação (radar): como terminaram os pedidos do período e em quanto tempo
  const outcomes = RADAR_CLOSE_REASONS.map((label) => ({ label, count: radarClosed.filter((r) => r.closeReason === label).length }));
  const solved = radarClosed.filter((r) => r.closeReason === "Agendou visita" || r.closeReason === "Alugou conosco");
  const avgDaysToSolve = solved.length ? Math.round(solved.reduce((a, r) => a + (r.closedAt!.getTime() - r.createdAt.getTime()) / DAY, 0) / solved.length) : null;
  const openRadars = radars.filter((r) => r.status !== "CLOSED");

  return {
    days: f.days,
    total: rows.length,
    radar: rows.filter((r) => r.source === "radar").length,
    searches: rows.filter((r) => r.source === "busca").length,
    open: rows.filter((r) => r.open).length,
    withProfile: rows.filter((r) => r.areas.length || r.propertyType || r.bedrooms || r.maxBudgetCents).length,
    byArea: byArea.slice(0, 10),
    byType,
    byBedrooms,
    byBudget,
    segments,
    capture: {
      closed: radarClosed.length,
      outcomes,
      solved: solved.length,
      solveRate: radarClosed.length ? solved.length / radarClosed.length : null,
      avgDaysToSolve,
      waiting15: openRadars.filter((r) => now.getTime() - r.createdAt.getTime() > 15 * DAY).length,
    },
  };
}

export type DemandSegment = Awaited<ReturnType<typeof demandMap>>["segments"][number];

/**
 * Oferta no site para cada segmento da demanda (mesmo bairro, tipo, quartos mínimos e aluguel até o valor do meio).
 * `supply` null = site não respondeu.
 */
export async function segmentSupply(actor: AuthzActor, segments: DemandSegment[], opts: { fetchImpl?: typeof fetch; origin?: string } = {}) {
  assert(canSeeDemand(actor));
  const origin = opts.origin ?? (await siteOrigin());
  return Promise.all(
    segments.map(async (s) => {
      const q = { ...profileQuery({ propertyType: s.type, bedrooms: s.bedrooms, maxBudgetCents: s.budgetCents, areas: [] }), area: s.area };
      const supply = await countOnSite(q, { ...opts, origin });
      const gap = supply == null ? null : supply === 0 ? "none" : supply < s.demand ? "low" : "ok";
      return { ...s, supply, gap: gap as "none" | "low" | "ok" | null, url: siteSearchUrl(origin, q) };
    }),
  );
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Texto pronto para mandar à captação (WhatsApp/e-mail): onde falta imóvel. */
export function captureBrief(days: number, rows: Awaited<ReturnType<typeof segmentSupply>>) {
  const lines = rows
    .filter((r) => r.gap === "none" || r.gap === "low")
    .map((r) => `• ${[r.type ?? "Imóvel", r.area, r.bedrooms ? `${r.bedrooms}+ quartos` : null, r.budgetCents ? `até ${brl(r.budgetCents)}` : null].filter(Boolean).join(" · ")} — ${r.demand} cliente${r.demand > 1 ? "s" : ""} procurando, ${r.supply === 0 ? "nenhum no site" : `só ${r.supply} no site`}`);
  if (!lines.length) return null;
  return [`Mapa da demanda (últimos ${days} dias) — onde falta imóvel:`, "", ...lines, "", "Fonte: pedidos do pré-atendimento e clientes em busca das consultoras (app Visitas Locação)."].join("\n");
}

// ─────────────── Pedidos para a captação ───────────────

/**
 * Pedidos do radar passados à captação e ainda em aberto, sem dados pessoais do cliente (nem nome, nem telefone):
 * o que procura, o perfil e há quanto tempo.
 */
export async function captureRequests(actor: AuthzActor, now = new Date()) {
  assert(canSeeDemand(actor));
  const rows = await db.clientRadar.findMany({
    where: { status: { in: ["SEARCHING", "FOUND"] }, sentToCaptureAt: { not: null } },
    orderBy: { sentToCaptureAt: "asc" },
    select: { id: true, wants: true, maxBudgetCents: true, areas: true, propertyType: true, bedrooms: true, sentToCaptureAt: true, foundCodes: true, status: true, createdBy: { select: { name: true } } },
    take: 300,
  });
  return rows.map((r) => ({ ...r, days: Math.max(0, Math.floor((now.getTime() - r.sentToCaptureAt!.getTime()) / DAY)) }));
}

/** Pedidos com a captação ainda sem nenhum imóvel indicado (número no menu da captação). */
export async function countCaptureOpen(actor: AuthzActor) {
  if (!canSeeDemand(actor)) return 0;
  return db.clientRadar.count({ where: { status: "SEARCHING", sentToCaptureAt: { not: null } } });
}
