/**
 * "Radar da demanda": quantos clientes procuravam imóvel em cada bairro, semana a semana (como a previsão do tempo
 * mostra a chuva andando). Conta pedidos do radar e clientes em busca que estavam em aberto na semana.
 * Só contagens por bairro: nenhum dado de cliente.
 */
import { db } from "@/lib/db";
import { assert, type AuthzActor } from "@/lib/authz";
import { TZ } from "@/lib/time";
import { canSeeDemand } from "./demand";
import { areaPoints, ensureAreaCoords } from "./area-geo";
import { normText } from "./site-search";

const DAY = 86400_000;
export const RADAR_WEEKS = 12;

type Item = { areas: string[]; from: Date; to: Date | null };

/** Quadros semanais (o último é "agora") com a demanda por bairro. Pura: usada nos testes. */
export function buildFrames(items: Item[], now: Date, weeks = RADAR_WEEKS) {
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
  const frames: { label: string; end: Date; counts: Map<string, number> }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * DAY);
    const start = new Date(end.getTime() - 7 * DAY);
    const counts = new Map<string, number>();
    for (const it of items) {
      if (it.from > end || (it.to && it.to < start)) continue;
      for (const k of new Set(it.areas.map(normText).filter(Boolean))) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    frames.push({ label: i === 0 ? "Agora" : `Semana de ${fmt.format(start)}`, end, counts });
  }
  return frames;
}

/**
 * Dados do mapa animado: bairros com coordenadas e, para cada semana, a demanda de cada um (mesma ordem).
 * Bairros ainda sem coordenadas são geocodificados aos poucos (até `geocode` por chamada).
 */
export async function demandRadar(actor: AuthzActor, now = new Date(), opts: { geocode?: number; fetchImpl?: typeof fetch } = {}) {
  assert(canSeeDemand(actor));
  const since = new Date(now.getTime() - RADAR_WEEKS * 7 * DAY);
  const [radars, searches] = await Promise.all([
    db.clientRadar.findMany({ where: { searchId: null, OR: [{ closedAt: null }, { closedAt: { gte: since } }] }, select: { areas: true, createdAt: true, closedAt: true } }),
    db.clientSearch.findMany({ where: { OR: [{ closedAt: null }, { closedAt: { gte: since } }] }, select: { areas: true, startedAt: true, closedAt: true } }),
  ]);
  const items: Item[] = [...radars.map((r) => ({ areas: r.areas, from: r.createdAt, to: r.closedAt })), ...searches.map((s) => ({ areas: s.areas, from: s.startedAt, to: s.closedAt }))];
  const all = items.flatMap((i) => i.areas);
  if (opts.geocode) await ensureAreaCoords(all, { maxCalls: opts.geocode, fetchImpl: opts.fetchImpl, now });
  const points = await areaPoints(all);
  const frames = buildFrames(items, now);
  const areas = [...points.values()].filter((p) => frames.some((f) => (f.counts.get(p.key) ?? 0) > 0));
  const missing = new Set(all.map(normText).filter((k) => k && !points.has(k))).size;
  return {
    areas: areas.map((a) => ({ name: a.name, lat: a.lat, lng: a.lng })),
    frames: frames.map((f) => ({ label: f.label, counts: areas.map((a) => f.counts.get(a.key) ?? 0) })),
    missing,
  };
}

export type DemandRadarData = Awaited<ReturnType<typeof demandRadar>>;
