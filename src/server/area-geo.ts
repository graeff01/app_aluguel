/**
 * Coordenadas dos bairros pedidos pelos clientes (OpenStreetMap/Nominatim), para o mapa animado da demanda.
 * Só o nome do bairro sai do sistema. Cache no banco; bairro não encontrado tenta de novo depois de 30 dias.
 */
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { geocode } from "./geo";
import { normText } from "./site-search";

const DAY = 86400_000;
const CITY = "Canoas - RS";

export type AreaPoint = { key: string; name: string; lat: number; lng: number };

/** Coordenadas já conhecidas dos bairros (os que ainda não têm ficam de fora). */
export async function areaPoints(areas: string[]): Promise<Map<string, AreaPoint>> {
  const keys = [...new Set(areas.map(normText).filter(Boolean))];
  if (!keys.length) return new Map();
  const rows = await db.areaGeo.findMany({ where: { key: { in: keys }, lat: { not: null } } });
  return new Map(rows.map((r) => [r.key, { key: r.key, name: r.name, lat: r.lat!, lng: r.lng! }]));
}

/** Geocodifica (com limite de chamadas: o serviço público aceita 1 por segundo) os bairros que faltam. */
export async function ensureAreaCoords(areas: string[], opts: { maxCalls?: number; fetchImpl?: typeof fetch; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const names = new Map<string, string>();
  for (const a of areas) {
    const k = normText(a);
    if (k && !names.has(k)) names.set(k, a.trim().replace(/[\s.,;:!]+$/, ""));
  }
  if (!names.size) return 0;
  const known = await db.areaGeo.findMany({ where: { key: { in: [...names.keys()] } } });
  const fresh = new Set(known.filter((r) => r.lat != null || now.getTime() - r.geocodedAt.getTime() < 30 * DAY).map((r) => r.key));
  let calls = 0;
  let found = 0;
  for (const [key, name] of names) {
    if (fresh.has(key)) continue;
    if (calls >= (opts.maxCalls ?? 3)) break;
    calls++;
    const hit = await geocode(`${name}, ${CITY}`, opts.fetchImpl);
    if (hit === "ERROR") continue;
    await db.areaGeo.upsert({
      where: { key },
      create: { key, name, lat: hit?.lat ?? null, lng: hit?.lng ?? null, geocodedAt: now },
      update: { name, lat: hit?.lat ?? null, lng: hit?.lng ?? null, geocodedAt: now },
    });
    if (hit) found++;
  }
  if (found) log.info("geo.areas", { found });
  return found;
}

/** Worker: bairros dos pedidos em aberto e das buscas ativas. */
export async function refreshAreaGeocodes(opts: { limit?: number; fetchImpl?: typeof fetch; now?: Date } = {}) {
  const [radars, searches] = await Promise.all([
    db.clientRadar.findMany({ where: { status: { in: ["SEARCHING", "FOUND"] } }, select: { areas: true }, take: 500 }),
    db.clientSearch.findMany({ where: { status: "ACTIVE" }, select: { areas: true }, take: 500 }),
  ]);
  return ensureAreaCoords([...radars, ...searches].flatMap((r) => r.areas), { maxCalls: opts.limit ?? 5, fetchImpl: opts.fetchImpl, now: opts.now });
}
