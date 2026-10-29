/**
 * Mapa de Canoas: procura (pedidos do radar em aberto e clientes em busca ativos) × imóveis nossos no site, por
 * bairro. Só contagens e dados públicos do site: nenhum dado de cliente.
 */
import { db } from "@/lib/db";
import { assert, type AuthzActor } from "@/lib/authz";
import { canSeeDemand } from "./demand";
import { areaPoints, ensureAreaCoords } from "./area-geo";
import { inventoryAreaNames, inventoryByArea } from "./site-inventory";
import { normText, TYPE_SEARCH } from "./site-search";

type Profile = { areas: string[]; propertyType: string | null; bedrooms: number | null; maxBudgetCents: number | null };

async function openDemand() {
  const [radars, searches] = await Promise.all([
    db.clientRadar.findMany({ where: { searchId: null, status: { in: ["SEARCHING", "FOUND"] } }, select: { areas: true, propertyType: true, bedrooms: true, maxBudgetCents: true } }),
    db.clientSearch.findMany({ where: { status: "ACTIVE" }, select: { areas: true, propertyType: true, bedrooms: true, maxBudgetCents: true } }),
  ]);
  return [...radars, ...searches] as Profile[];
}

/** Situação do bairro: procura sem nenhum imóvel nosso, pouca oferta, ou temos oferta. */
export function areaStatus(demand: number, supply: number): "none" | "low" | "ok" | "idle" {
  if (!demand) return "idle";
  if (!supply) return "none";
  return supply < demand * 2 ? "low" : "ok";
}

/** Pontos do mapa: cada bairro com procura e/ou imóveis nossos. Geocodifica aos poucos os que faltam. */
export async function cityMap(actor: AuthzActor, opts: { geocode?: number; fetchImpl?: typeof fetch; now?: Date } = {}) {
  assert(canSeeDemand(actor));
  const [demand, supply, invNames] = await Promise.all([openDemand(), inventoryByArea(), inventoryAreaNames()]);
  const counts = new Map<string, { name: string; n: number }>();
  for (const d of demand)
    for (const a of new Set(d.areas.map((x) => x.trim()).filter(Boolean))) {
      const k = normText(a);
      const cur = counts.get(k) ?? { name: a.replace(/[\s.,;:!]+$/, ""), n: 0 };
      cur.n++;
      counts.set(k, cur);
    }
  const allNames = [...[...counts.values()].map((c) => c.name), ...invNames];
  if (opts.geocode) await ensureAreaCoords(allNames, { maxCalls: opts.geocode, fetchImpl: opts.fetchImpl, now: opts.now });
  const points = await areaPoints(allNames);
  const keys = new Set([...counts.keys(), ...supply.keys()]);
  const areas = [...keys]
    .filter((k) => points.has(k))
    .map((k) => {
      const p = points.get(k)!;
      const s = supply.get(k) ?? { res: 0, com: 0 };
      const dem = counts.get(k)?.n ?? 0;
      return { key: k, name: counts.get(k)?.name ?? p.name, lat: p.lat, lng: p.lng, demand: dem, res: s.res, com: s.com, status: areaStatus(dem, s.res) };
    })
    .sort((a, b) => b.demand - a.demand || b.res - a.res);
  const missing = [...keys].filter((k) => !points.has(k)).length;
  const lastCrawl = await db.siteInventory.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } });
  return {
    areas,
    missing,
    inventoryAt: lastCrawl?.lastSeenAt ?? null,
    totals: { demand: demand.length, res: areas.reduce((a, x) => a + x.res, 0), com: areas.reduce((a, x) => a + x.com, 0) },
  };
}
export type CityMapData = Awaited<ReturnType<typeof cityMap>>;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/** Ao tocar num bairro: o que procuram ali e os nossos imóveis do bairro no site (residenciais primeiro). */
export async function areaDetail(actor: AuthzActor, key: string) {
  assert(canSeeDemand(actor));
  const k = normText(key);
  const demand = (await openDemand()).filter((d) => d.areas.some((a) => normText(a) === k));
  const byType = new Map<string, number>();
  for (const d of demand) byType.set(d.propertyType ?? "Qualquer tipo", (byType.get(d.propertyType ?? "Qualquer tipo") ?? 0) + 1);
  // primeiro o tipo que os clientes procuram ali; depois residenciais e o menor valor
  const wanted = demand.flatMap((d) => (d.propertyType ? (TYPE_SEARCH[d.propertyType]?.words ?? []) : []));
  const fits = (cat: string | null) => !!cat && wanted.some((w) => new RegExp(`\\b${w}\\b`).test(normText(cat)));
  const listings = (await db.siteInventory.findMany({ where: { areaKey: k, goneAt: null }, orderBy: [{ kind: "desc" }, { rentCents: "asc" }], take: 200 }))
    .map((l, i) => ({ l, i, score: fits(l.category) ? 0 : 1 }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, 40)
    .map((x) => x.l);
  // pedidos do radar com a captação nesse bairro (para indicar dali mesmo)
  const pedidos = await db.clientRadar.findMany({
    where: { status: { in: ["SEARCHING", "FOUND"] }, sentToCaptureAt: { not: null }, areas: { isEmpty: false } },
    select: { id: true, areas: true, propertyType: true, bedrooms: true, maxBudgetCents: true, foundCodes: true },
  });
  return {
    demand: demand.length,
    types: [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n })),
    bedrooms: median(demand.map((d) => d.bedrooms).filter((x): x is number => x != null)),
    budgetCents: median(demand.map((d) => d.maxBudgetCents).filter((x): x is number => !!x)),
    listings: listings.map((l) => ({ code: l.code, kind: l.kind, category: l.category, neighborhood: l.neighborhood, bedrooms: l.bedrooms, rentCents: l.rentCents, totalCents: l.totalCents, photoUrl: l.photoUrl, url: l.url })),
    pedidos: pedidos.filter((p) => p.areas.some((a) => normText(a) === k)),
  };
}
export type AreaDetail = Awaited<ReturnType<typeof areaDetail>>;
