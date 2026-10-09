/**
 * Mapa da rota: coordenadas dos imóveis (OpenStreetMap/Nominatim) e trajeto de carro (OSRM).
 * Só o ENDEREÇO DO IMÓVEL (ou o bairro) sai do sistema — nunca nome, telefone ou dados do cliente.
 * Respeita as regras de uso dos serviços públicos: identificação no User-Agent, 1 consulta por segundo,
 * cache no banco (coordenadas) e em memória (trajetos). Falhas nunca quebram a tela: o mapa só fica sem a linha.
 */
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { routeQuery } from "@/lib/address";

const DAY = 86400_000;
const UA = () => `VisitasLocacao/1.0 (+${env.appUrl})`;
// região metropolitana de Porto Alegre (preferência, não limite)
const VIEWBOX = "-51.45,-29.70,-50.90,-30.20";

let lastGeocodeAt = 0;
async function throttle() {
  if (process.env.VITEST === "true") return;
  const wait = lastGeocodeAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeocodeAt = Date.now();
}

export type GeoPoint = { lat: number; lng: number };

/** MAP_SERVICES=off desliga as consultas externas (o mapa usa só coordenadas já salvas). */
export const mapServicesOn = () => process.env.MAP_SERVICES !== "off";

export async function geocode(query: string, fetchImpl?: typeof fetch): Promise<GeoPoint | null | "ERROR"> {
  if (!fetchImpl && !mapServicesOn()) return "ERROR";
  fetchImpl ??= fetch;
  await throttle();
  try {
    const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", countrycodes: "br", viewbox: VIEWBOX, "accept-language": "pt-BR" });
    const res = await fetchImpl(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { "user-agent": UA(), accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return "ERROR";
    const data = (await res.json()) as { lat?: string; lon?: string }[];
    const hit = data[0];
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return "ERROR";
  }
}

type GeoProp = { id: string; code: string; address: string | null; neighborhood: string | null; city: string | null; geoQuery: string | null; geoPrecision: string | null; geocodedAt: Date | null };

function needsGeocode(p: GeoProp, now: Date) {
  const q = routeQuery(p);
  if (!q) return null;
  if (p.geoQuery === q.query && p.geocodedAt) {
    // não encontrado: tenta de novo depois de 7 dias
    if (p.geoPrecision !== "NONE" || now.getTime() - p.geocodedAt.getTime() < 7 * DAY) return null;
  }
  return q;
}

/** Geocodifica (com limite de chamadas) os imóveis indicados que ainda não têm coordenadas atuais. */
export async function ensurePropertyCoords(codes: string[], opts: { maxCalls?: number; fetchImpl?: typeof fetch; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  if (!codes.length) return { geocoded: 0 };
  const props = await db.property.findMany({
    where: { code: { in: [...new Set(codes)] } },
    select: { id: true, code: true, address: true, neighborhood: true, city: true, geoQuery: true, geoPrecision: true, geocodedAt: true },
  });
  let calls = 0;
  let geocoded = 0;
  for (const p of props) {
    const q = needsGeocode(p, now);
    if (!q) continue;
    if (calls >= (opts.maxCalls ?? 4)) break;
    calls++;
    let hit = await geocode(q.query, opts.fetchImpl);
    let precision = q.approximate ? "AREA" : "ADDRESS";
    // endereço não encontrado: cai para o bairro (marcado como aproximado)
    if (hit === null && !q.approximate && p.neighborhood && calls < (opts.maxCalls ?? 4)) {
      calls++;
      hit = await geocode(`${p.neighborhood}, ${p.city || "Canoas"} - RS`, opts.fetchImpl);
      precision = "AREA";
    }
    if (hit === "ERROR") continue; // tenta de novo no próximo ciclo
    await db.property.update({
      where: { id: p.id },
      data: hit ? { lat: hit.lat, lng: hit.lng, geoQuery: q.query, geoPrecision: precision, geocodedAt: now } : { lat: null, lng: null, geoQuery: q.query, geoPrecision: "NONE", geocodedAt: now },
    });
    if (hit) geocoded++;
  }
  if (geocoded) log.info("geo.geocoded", { properties: geocoded });
  return { geocoded };
}

/** Worker: imóveis com visitas agendadas de agora até 3 dias à frente. */
export async function refreshGeocodes(opts: { limit?: number; fetchImpl?: typeof fetch; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const props = await db.property.findMany({
    where: {
      visits: { some: { status: "SCHEDULED", excluded: false, scheduledStart: { gte: new Date(now.getTime() - 3600_000), lte: new Date(now.getTime() + 3 * DAY) } } },
      OR: [{ address: { not: null } }, { neighborhood: { not: null } }],
    },
    select: { code: true },
    take: 40,
  });
  return ensurePropertyCoords(
    props.map((p) => p.code),
    { maxCalls: opts.limit ?? 6, fetchImpl: opts.fetchImpl, now },
  );
}

// ─────────────── Trajeto de carro ───────────────

export type DrivingRoute = { legs: { minutes: number; km: number }[]; line: [number, number][] };
const routeCache = new Map<string, { at: number; value: DrivingRoute | null }>();

/** Trajeto passando pelos pontos na ordem dada (até 25). null quando o serviço não responde. */
export async function drivingRoute(points: GeoPoint[], fetchImpl?: typeof fetch): Promise<DrivingRoute | null> {
  if (points.length < 2) return null;
  if (!fetchImpl && !mapServicesOn()) return null;
  fetchImpl ??= fetch;
  const pts = points.slice(0, 25);
  const key = pts.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? 30 : 2) * 60_000) return hit.value;
  let value: DrivingRoute | null = null;
  try {
    const res = await fetchImpl(`https://router.project-osrm.org/route/v1/driving/${key}?overview=simplified&geometries=geojson&steps=false`, {
      headers: { "user-agent": UA() },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { code?: string; routes?: { legs: { duration: number; distance: number }[]; geometry: { coordinates: [number, number][] } }[] };
      const r = data.code === "Ok" ? data.routes?.[0] : undefined;
      if (r) {
        value = {
          legs: r.legs.map((l) => ({ minutes: Math.max(1, Math.round(l.duration / 60)), km: Math.round(l.distance / 100) / 10 })),
          line: r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
        };
      }
    }
  } catch {
    value = null;
  }
  routeCache.set(key, { at: Date.now(), value });
  if (routeCache.size > 200) routeCache.delete(routeCache.keys().next().value!);
  return value;
}
