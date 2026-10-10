/**
 * Pré-visualização do imóvel a partir da página pública (og:image e og:title).
 * Só o código do imóvel é usado na consulta — nenhum dado de cliente sai do sistema.
 * Executado pelo worker em lotes pequenos, com intervalo entre requisições e cache.
 */
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/log";

const DAY = 86400_000;

export function propertyUrl(template: string, code: string) {
  return template.replace(/\{codigo\}/g, encodeURIComponent(code));
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function meta(html: string, prop: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content).trim() : null;
}

export type Listing = {
  category: string | null;
  neighborhood: string | null;
  city: string | null;
  rent: number | null;
  totalPrice: number | null;
  condoFee: number | null;
  iptu: number | null;
  area: number | null;
  bedrooms: number | null;
  photos: string[];
};
export type Preview = { status: "OK" | "NOT_FOUND" | "ERROR"; photoUrl: string | null; title: string | null; listing?: Listing };

const EMPTY_LISTING: Listing = { category: null, neighborhood: null, city: null, rent: null, totalPrice: null, condoFee: null, iptu: null, area: null, bedrooms: null, photos: [] };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/\./g, "").replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n) : null;
};
const txt = (v: unknown, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Busca recursiva do primeiro objeto que tenha "offers" (o anúncio) dentro do JSON-LD. */
function findListingNode(v: unknown, depth = 0): Json | null {
  if (depth > 6) return null;
  for (const item of arr(v)) {
    const o = obj(item);
    if (!o) continue;
    if (o.offers) return o;
    for (const k of ["@graph", "mainEntity", "about"]) {
      const f = findListingNode(o[k], depth + 1);
      if (f) return f;
    }
  }
  return null;
}

/**
 * Dados públicos do anúncio a partir do JSON-LD (schema.org) da página.
 * O endereço do JSON-LD é o da agência, não o do imóvel — por isso não é usado.
 * Bairro/cidade vêm do nome "Tipo - Bairro - Cidade" ou do og:title "... em Bairro, Cidade.".
 */
export function parseListing(html: string, ogTitle: string | null): Listing {
  const out: Listing = { ...EMPTY_LISTING, photos: [] };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const node = findListingNode(data);
    if (!node) continue;
    const offer = obj(arr(node.offers)[0]);
    const item = obj(offer?.itemOffered);
    const specs = arr(offer?.priceSpecification).map(obj).filter((x): x is Json => !!x);
    const spec = (name: string) => num(specs.find((p) => typeof p.name === "string" && p.name.toLowerCase().startsWith(name))?.price);
    out.rent = spec("aluguel") ?? num(offer?.price);
    out.totalPrice = spec("total");
    out.condoFee = spec("condom");
    out.iptu = spec("iptu");
    const imgs = [...arr(node.image), ...arr(item?.image)].map((i) => (typeof i === "string" ? i : obj(i)?.url)).filter((u): u is string => typeof u === "string" && /^https:\/\//i.test(u));
    out.photos = [...new Set(imgs)].slice(0, 8);
    out.category = txt(item?.accommodationCategory, 40);
    out.area = num(obj(item?.floorSize)?.value);
    out.bedrooms = num(item?.numberOfRooms);
    const parts = typeof item?.name === "string" ? item.name.split(" - ").map((x) => x.trim()) : [];
    if (parts.length >= 3) {
      out.category ??= txt(parts[0], 40);
      out.neighborhood = txt(parts[1]);
      out.city = txt(parts[2]);
    }
    break;
  }
  if (!out.neighborhood && ogTitle) {
    const mm = ogTitle.match(/\bem ([^,]+), ([^.]+)\.?$/);
    if (mm) {
      out.neighborhood = txt(mm[1]);
      out.city = txt(mm[2]);
    }
  }
  return out;
}

export async function fetchPreview(url: string, fetchImpl: typeof fetch = fetch): Promise<Preview> {
  try {
    const res = await fetchImpl(url, {
      headers: { "user-agent": "VisitasLocacao/1.0 (+pre-visualizacao de imovel)", accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return { status: "NOT_FOUND", photoUrl: null, title: null };
    if (!res.ok) return { status: "ERROR", photoUrl: null, title: null };
    const html = (await res.text()).slice(0, 800_000);
    const image = meta(html, "og:image:secure_url") ?? meta(html, "og:image");
    const title = meta(html, "og:title");
    const photoUrl = image && /^https:\/\//i.test(image) ? image : null;
    if (!photoUrl && !title) return { status: "NOT_FOUND", photoUrl: null, title: null };
    return { status: "OK", photoUrl, title: title ? title.slice(0, 200) : null, listing: parseListing(html, title) };
  } catch {
    return { status: "ERROR", photoUrl: null, title: null };
  }
}

/** Atualiza um lote de imóveis com visitas recentes cujo cache expirou. */
export async function refreshPropertyPreviews(opts: { limit?: number; fetchImpl?: typeof fetch; pauseMs?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const settings = await getSettings();
  if (!settings.propertyUrlTemplate.includes("{codigo}")) return { updated: 0 };
  const candidates = await db.property.findMany({
    where: {
      visits: { some: { scheduledStart: { gte: new Date(now.getTime() - 120 * DAY) } } },
      OR: [
        { pageCheckedAt: null },
        { pageStatus: "OK", pageCheckedAt: { lt: new Date(now.getTime() - 7 * DAY) } },
        { pageStatus: { not: "OK" }, pageCheckedAt: { lt: new Date(now.getTime() - DAY) } },
      ],
    },
    orderBy: [{ pageCheckedAt: { sort: "asc", nulls: "first" } }],
    take: opts.limit ?? 12,
  });
  let updated = 0;
  for (const p of candidates) {
    const pv = await fetchPreview(propertyUrl(settings.propertyUrlTemplate, p.code), opts.fetchImpl);
    await db.property.update({
      where: { id: p.id },
      data: {
        pageStatus: pv.status,
        pageCheckedAt: now,
        // falha temporária não apaga a foto já conhecida
        ...(pv.status === "ERROR" ? {} : { photoUrl: pv.photoUrl, title: pv.title, ...(pv.listing ?? EMPTY_LISTING) }),
      },
    });
    updated++;
    if (opts.pauseMs !== 0) await new Promise((r) => setTimeout(r, opts.pauseMs ?? 1500));
  }
  if (updated) log.info("property_preview.refreshed", { updated });
  return { updated };
}
