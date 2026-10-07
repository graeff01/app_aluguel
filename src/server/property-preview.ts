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

export type Preview = { status: "OK" | "NOT_FOUND" | "ERROR"; photoUrl: string | null; title: string | null };

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
    return { status: "OK", photoUrl, title: title ? title.slice(0, 200) : null };
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
        ...(pv.status === "ERROR" ? {} : { photoUrl: pv.photoUrl, title: pv.title }),
      },
    });
    updated++;
    if (opts.pauseMs !== 0) await new Promise((r) => setTimeout(r, opts.pauseMs ?? 1500));
  }
  if (updated) log.info("property_preview.refreshed", { updated });
  return { updated };
}
