/**
 * Busca no site público da imobiliária (as mesmas páginas de "Alugar" que o cliente vê), para sugerir imóveis
 * parecidos com o que um cliente procura. Só o perfil vai na consulta (cidade, bairro, tipo, quartos e valor):
 * nenhum dado do cliente sai do sistema.
 *
 * A página de busca é renderizada no servidor do site e traz a lista de imóveis no payload do Next.js
 * (self.__next_f.push): código, categoria, dormitórios, valores, bairro e fotos.
 */
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/log";

export type SiteListing = {
  code: string;
  category: string | null;
  bedrooms: number | null;
  /** aluguel e total (aluguel + condomínio + IPTU), em centavos */
  rentCents: number | null;
  totalCents: number | null;
  neighborhood: string | null;
  city: string | null;
  photoUrl: string | null;
  url: string;
};

export type SiteQuery = { city: string; kind: "residencial" | "comercial"; area?: string | null; type?: string | null; minBedrooms?: number | null; maxRentReais?: number | null; page?: number };

/** Cidade das buscas (slug do site). */
export const SITE_CITY = "rs+canoas";

export const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Endereço da busca no site (também serve de link "ver mais no site"). */
export function siteSearchUrl(origin: string, q: SiteQuery) {
  const path = `${q.city}${q.area ? `+${slugify(q.area)}` : ""}`;
  const params = new URLSearchParams();
  if (q.type) params.set("tipoImovel", q.type);
  if (q.minBedrooms) params.set("quartos", String(q.minBedrooms));
  if (q.maxRentReais) params.set("valorMax", String(Math.round(q.maxRentReais)));
  if (q.page && q.page > 1) params.set("page", String(q.page));
  return `${origin}/alugar/${q.kind}/${path}${params.size ? `?${params}` : ""}`;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);

/** Lê a lista de imóveis da página de busca. Formato inesperado → lista vazia (nunca lança). */
export function parseSearchPage(html: string, origin: string): { items: SiteListing[]; total: number | null } {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let chunk: string;
    try {
      chunk = JSON.parse(m[1]) as string;
    } catch {
      continue;
    }
    if (!chunk.includes('"initialData":')) continue;
    try {
      const arr = JSON.parse(chunk.slice(chunk.indexOf("["))) as unknown[];
      const props = arr.find((x): x is { initialData: unknown[]; totalItems?: number } => !!x && typeof x === "object" && Array.isArray((x as { initialData?: unknown }).initialData));
      if (!props) continue;
      const items: SiteListing[] = [];
      for (const raw of props.initialData) {
        const d = raw as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const code = typeof d?.codigo === "string" && /^[\w-]{2,40}$/.test(d.codigo) ? d.codigo : null;
        if (!code) continue;
        const rent = num(d.valores?.valor);
        const total = num(d.valores?.valorTotal);
        const photo = Array.isArray(d.fotos) && typeof d.fotos[0] === "string" && /^https:\/\//.test(d.fotos[0]) ? d.fotos[0] : null;
        const link = typeof d.link === "string" && d.link.startsWith(origin) ? d.link : `${origin}/imovel/aluguel/${code}`;
        items.push({
          code,
          category: txt(d.categoria?.nome),
          bedrooms: num(d.dormitorios),
          rentCents: rent ? Math.round(rent * 100) : null,
          totalCents: total ? Math.round(total * 100) : null,
          neighborhood: txt(d.endereco?.bairro?.nome),
          city: txt(d.endereco?.cidade?.nome),
          photoUrl: photo,
          url: link,
        });
      }
      return { items, total: typeof props.totalItems === "number" ? props.totalItems : null };
    } catch {
      continue;
    }
  }
  return { items: [], total: null };
}

const cache = new Map<string, { at: number; items: SiteListing[] }>();
const CACHE_MS = 30 * 60_000;

export async function siteOrigin() {
  try {
    return new URL((await getSettings()).propertyUrlTemplate.replace("{codigo}", "0")).origin;
  } catch {
    return "https://www.auxiliadorapredial.com.br";
  }
}

/** Uma página de busca do site (com cache de 30 min). Erro de rede → null. */
export async function searchSite(q: SiteQuery, opts: { fetchImpl?: typeof fetch; origin?: string } = {}): Promise<SiteListing[] | null> {
  const origin = opts.origin ?? (await siteOrigin());
  const url = siteSearchUrl(origin, q);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      headers: { "user-agent": "VisitasLocacao/1.0 (+sugestao de imoveis)", accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 404) return [];
    if (!res.ok) return null;
    const { items } = parseSearchPage((await res.text()).slice(0, 2_000_000), origin);
    cache.set(url, { at: Date.now(), items });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return items;
  } catch (e) {
    log.warn("site_search.failed", { kind: (e as { name?: string }).name ?? "OTHER" });
    return null;
  }
}
