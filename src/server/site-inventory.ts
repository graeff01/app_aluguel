/**
 * Imóveis de aluguel da Auxiliadora em Canoas, lidos do site uma vez por dia (todas as páginas da busca residencial
 * e comercial, ~1 página por segundo). Guarda o que aparece e marca o que saiu (alugado ou retirado).
 * Dado público do nosso próprio site: nada de cliente.
 */
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { dayKey, TZ } from "@/lib/time";
import { normText, parseSearchPage, siteOrigin, siteSearchUrl, SITE_CITY, type SiteListing } from "./site-search";

const HOUR = 3600_000;
const MAX_PAGES = 80;
export const CRAWL_HOUR = 6;

const localHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(d));
const sleep = (ms: number) => (process.env.VITEST === "true" || ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

async function fetchPage(url: string, origin: string, fetchImpl: typeof fetch) {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": "VisitasLocacao/1.0 (+mapa de imoveis)", accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return { items: [] as SiteListing[], total: 0 };
    if (!res.ok) return null;
    return parseSearchPage((await res.text()).slice(0, 3_000_000), origin);
  } catch {
    return null;
  }
}

/** Todas as páginas de um tipo de busca. `complete`: leu tudo (o que não apareceu pode ser marcado como saiu). */
async function crawlKind(kind: "residencial" | "comercial", origin: string, fetchImpl: typeof fetch, throttleMs: number) {
  const seen = new Map<string, SiteListing>();
  let total: number | null = null;
  let failed = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetchPage(siteSearchUrl(origin, { city: SITE_CITY, kind, page }), origin, fetchImpl);
    if (!r) {
      failed = true;
      break;
    }
    total ??= r.total;
    for (const it of r.items) seen.set(it.code, it);
    if (!r.items.length || (total != null && seen.size >= total)) break;
    await sleep(throttleMs);
  }
  // "completo" só sem erro e com quase tudo lido (o total do site muda durante a leitura)
  const complete = !failed && (total == null ? seen.size > 0 : seen.size >= total * 0.9);
  return { items: [...seen.values()], total, complete };
}

/** Uma vez por dia (a partir das 6h): atualiza o inventário. `force` ignora o horário e a última leitura. */
export async function crawlSiteInventory(now = new Date(), opts: { fetchImpl?: typeof fetch; origin?: string; force?: boolean; throttleMs?: number } = {}) {
  if (!opts.force) {
    if (localHour(now) < CRAWL_HOUR) return null;
    const last = await db.siteInventory.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } });
    if (last && dayKey(last.lastSeenAt) === dayKey(now) && now.getTime() - last.lastSeenAt.getTime() < 20 * HOUR) return null;
  }
  const origin = opts.origin ?? (await siteOrigin());
  const fetchImpl = opts.fetchImpl ?? fetch;
  const result: Record<string, { seen: number; total: number | null; gone: number }> = {};
  for (const kind of ["residencial", "comercial"] as const) {
    const r = await crawlKind(kind, origin, fetchImpl, opts.throttleMs ?? 900);
    for (const it of r.items) {
      const data = { kind, category: it.category, bedrooms: it.bedrooms, rentCents: it.rentCents, totalCents: it.totalCents, neighborhood: it.neighborhood, areaKey: it.neighborhood ? normText(it.neighborhood) : null, photoUrl: it.photoUrl, url: it.url, lastSeenAt: now, goneAt: null };
      await db.siteInventory.upsert({ where: { code: it.code }, create: { code: it.code, firstSeenAt: now, ...data }, update: data });
    }
    let gone = 0;
    if (r.complete) gone = (await db.siteInventory.updateMany({ where: { kind, goneAt: null, lastSeenAt: { lt: now } }, data: { goneAt: now } })).count;
    result[kind] = { seen: r.items.length, total: r.total, gone };
  }
  log.info("site_inventory.crawled", { residencial: result.residencial?.seen ?? 0, comercial: result.comercial?.seen ?? 0, saiu: (result.residencial?.gone ?? 0) + (result.comercial?.gone ?? 0) });
  return result;
}

/** Imóveis no site agora, por bairro normalizado (residencial e comercial). */
export async function inventoryByArea() {
  const rows = await db.siteInventory.groupBy({ by: ["areaKey", "kind"], where: { goneAt: null, areaKey: { not: null } }, _count: { _all: true } });
  const out = new Map<string, { res: number; com: number }>();
  for (const r of rows) {
    const cur = out.get(r.areaKey!) ?? { res: 0, com: 0 };
    if (r.kind === "comercial") cur.com += r._count._all;
    else cur.res += r._count._all;
    out.set(r.areaKey!, cur);
  }
  return out;
}

/** Nome de exibição de cada bairro do inventário (o que o site escreve). */
export async function inventoryAreaNames() {
  const rows = await db.siteInventory.findMany({ where: { goneAt: null, neighborhood: { not: null } }, distinct: ["areaKey"], select: { areaKey: true, neighborhood: true } });
  return rows.map((r) => r.neighborhood!);
}
