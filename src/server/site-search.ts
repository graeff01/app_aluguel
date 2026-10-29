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
import { REJECT_REASONS, type RejectReason } from "@/lib/reject-reasons";

export type SiteListing = {
  code: string;
  category: string | null;
  bedrooms: number | null;
  /** vagas de garagem (0 = sem vaga; null = o anúncio não informa) */
  parking: number | null;
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
/** contagem que aceita zero ("0" vagas) */
const count = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n < 100 ? n : null;
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
          parking: count(d.vagas),
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

const cache = new Map<string, { at: number; items: SiteListing[]; total: number | null }>();
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
  return (await searchSitePage(q, opts))?.items ?? null;
}

/** Quantos imóveis o site tem com este filtro (oferta). Erro → null. */
export async function countOnSite(q: SiteQuery, opts: { fetchImpl?: typeof fetch; origin?: string } = {}): Promise<number | null> {
  const r = await searchSitePage(q, opts);
  return r ? (r.total ?? r.items.length) : null;
}

/** Uma página de busca: imóveis e total. Erro → null. */
export async function searchSitePage(q: SiteQuery, opts: { fetchImpl?: typeof fetch; origin?: string } = {}): Promise<{ items: SiteListing[]; total: number | null } | null> {
  const origin = opts.origin ?? (await siteOrigin());
  const url = siteSearchUrl(origin, q);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      headers: { "user-agent": "VisitasLocacao/1.0 (+sugestao de imoveis)", accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 404) return { items: [], total: 0 };
    if (!res.ok) return null;
    const page = parseSearchPage((await res.text()).slice(0, 2_000_000), origin);
    cache.set(url, { at: Date.now(), ...page });
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    return page;
  } catch (e) {
    log.warn("site_search.failed", { kind: (e as { name?: string }).name ?? "OTHER" });
    return null;
  }
}

/** Limpa o cache (testes). */
export const clearSiteCache = () => cache.clear();

// ─────────────── Imóveis parecidos com um perfil ───────────────

export const normText = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[\s.,;:!]+$/, "");

/** Tipo do perfil → filtro do site (quando o site tem) e palavras da categoria do anúncio. */
export const TYPE_SEARCH: Record<string, { slug: string | null; kind: "residencial" | "comercial"; words: string[] }> = {
  Apartamento: { slug: "apartamento", kind: "residencial", words: ["apartamento"] },
  Casa: { slug: "casa", kind: "residencial", words: ["casa"] },
  Sobrado: { slug: "sobrado", kind: "residencial", words: ["sobrado"] },
  Cobertura: { slug: "cobertura", kind: "residencial", words: ["cobertura"] },
  "Kitnet / studio": { slug: "kitnet-jk", kind: "residencial", words: ["kitnet", "kit", "studio", "jk", "loft"] },
  Comercial: { slug: null, kind: "comercial", words: [] },
};

/**
 * O que o app aprendeu com as opções marcadas "fora do perfil" (por cliente): teto de valor estrito, bairros e
 * tipos a evitar, quartos mínimos e exigência de vaga de garagem.
 */
export type LearnedRules = { priceCapCents?: number | null; avoidAreas?: string[]; avoidCategories?: string[]; minBedrooms?: number | null; needsGarage?: boolean };
export type SearchProfile = { maxBudgetCents: number | null; areas: string[]; propertyType: string | null; bedrooms: number | null; exclude?: string[]; rules?: LearnedRules | null };
export type SimilarListing = SiteListing & { reasons: string[] };
export type SimilarResult = { items: SimilarListing[]; error: boolean; moreUrl: string | null; searched: boolean };

export const hasProfile = (p: SearchProfile) => !!(p.maxBudgetCents || p.areas.length || p.propertyType || p.bedrooms);

/** Consulta base do site para um perfil (sem bairro). */
export function profileQuery(p: SearchProfile): SiteQuery {
  const t = p.propertyType ? TYPE_SEARCH[p.propertyType] : undefined;
  const minBedrooms = Math.max(p.bedrooms ?? 0, p.rules?.minBedrooms ?? 0) || null;
  const cap = [p.maxBudgetCents, p.rules?.priceCapCents].filter((x): x is number => !!x);
  return { city: SITE_CITY, kind: t?.kind ?? "residencial", type: t?.slug ?? null, minBedrooms, maxRentReais: cap.length ? Math.min(...cap) / 100 : null };
}

/**
 * Imóveis do site parecidos com o perfil (cidade da agência): busca por bairro (até 3), tipo, quartos mínimos e
 * valor; o total (aluguel + condomínio + IPTU) pode passar até 10% do valor máximo. Sem perfil não busca.
 * `error`: o site não respondeu.
 */
export async function findSimilarOnSite(p: SearchProfile, opts: { fetchImpl?: typeof fetch; origin?: string; limit?: number } = {}): Promise<SimilarResult> {
  if (!hasProfile(p)) return { items: [], error: false, moreUrl: null, searched: false };
  const origin = opts.origin ?? (await siteOrigin());
  const t = p.propertyType ? TYPE_SEARCH[p.propertyType] : undefined;
  const base = profileQuery(p);
  const areas = p.areas.slice(0, 3);
  const run = (qs: SiteQuery[]) => Promise.all(qs.map((q) => searchSite(q, { fetchImpl: opts.fetchImpl, origin })));
  // por bairro; sem bairro (ou bairro que o site não conhece), a cidade toda
  let pages = await run(areas.length ? areas.map((a) => ({ ...base, area: a })) : [base, { ...base, page: 2 }]);
  if (areas.length && pages.every((x) => x !== null && x.length === 0)) pages = await run([base, { ...base, page: 2 }]);
  const error = pages.every((x) => x === null);
  const wantedAreas = areas.map(normText);
  const seen = new Set(p.exclude ?? []);
  const scored: (SimilarListing & { score: number })[] = [];
  for (const it of pages.flatMap((x) => x ?? [])) {
    if (seen.has(it.code)) continue;
    seen.add(it.code);
    const reasons: string[] = [];
    let score = 0;
    // o que já ficou "fora do perfil" deste cliente
    const r = p.rules;
    if (r) {
      const priceNow = it.totalCents ?? it.rentCents;
      if (r.priceCapCents && priceNow && priceNow > r.priceCapCents) continue;
      if (r.avoidAreas?.length && it.neighborhood && r.avoidAreas.some((a) => normText(a) === normText(it.neighborhood!))) continue;
      if (r.avoidCategories?.length && it.category && r.avoidCategories.some((c) => normText(c) === normText(it.category!))) continue;
      if (r.minBedrooms && it.bedrooms != null && it.bedrooms < r.minBedrooms) continue;
      if (r.needsGarage && it.parking === 0) continue;
    }
    if (t?.words.length) {
      const cat = normText(it.category ?? "");
      if (!t.words.some((w) => new RegExp(`\\b${w}\\b`).test(cat))) continue;
    }
    const price = it.totalCents ?? it.rentCents;
    if (p.maxBudgetCents) {
      if (!price || price > p.maxBudgetCents * 1.1) continue;
      reasons.push(price <= p.maxBudgetCents ? "dentro do valor" : "um pouco acima do valor");
      score += price <= p.maxBudgetCents ? 2 : 1;
    }
    if (wantedAreas.length && it.neighborhood) {
      const n = normText(it.neighborhood);
      if (wantedAreas.some((a) => n.includes(a) || a.includes(n))) {
        reasons.push(`no ${it.neighborhood}`);
        score += 3;
      }
    }
    if (p.bedrooms && it.bedrooms) {
      if (it.bedrooms < p.bedrooms) continue;
      reasons.push(it.bedrooms === p.bedrooms ? `${it.bedrooms} quarto${it.bedrooms > 1 ? "s" : ""}` : `${it.bedrooms} quartos`);
      score += it.bedrooms === p.bedrooms ? 2 : 1;
    }
    scored.push({ ...it, reasons, score });
  }
  const items = scored
    .sort((a, b) => b.score - a.score || (a.totalCents ?? a.rentCents ?? 0) - (b.totalCents ?? b.rentCents ?? 0))
    .slice(0, opts.limit ?? 8)
    .map(({ score: _score, ...rest }) => rest);
  return { items, error, moreUrl: siteSearchUrl(origin, { ...base, area: areas.length === 1 ? areas[0] : null }), searched: true };
}

// ─────────────── "Fora do perfil": aprender com a opção recusada ───────────────

export { REJECT_REASONS, type RejectReason };
export type RejectedListing = { code: string; category: string | null; neighborhood: string | null; bedrooms: number | null; priceCents: number | null };

const brlShort = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Ajusta as regras do cliente pelo motivo; devolve as regras novas e uma frase do que mudou (ou null). */
export function learnFromRejection(rules: LearnedRules | null | undefined, reason: RejectReason, l: RejectedListing): { rules: LearnedRules; learned: string | null } {
  const r: LearnedRules = { ...(rules ?? {}) };
  const add = (list: string[] | undefined, v: string) => [...new Set([...(list ?? []), v])].slice(0, 20);
  if (reason === "PRICE" && l.priceCents) {
    const cap = l.priceCents - 100; // abaixo do valor recusado
    r.priceCapCents = r.priceCapCents ? Math.min(r.priceCapCents, cap) : cap;
    return { rules: r, learned: `só até ${brlShort(r.priceCapCents)}` };
  }
  if (reason === "AREA" && l.neighborhood) {
    r.avoidAreas = add(r.avoidAreas, l.neighborhood);
    return { rules: r, learned: `sem imóveis no ${l.neighborhood}` };
  }
  if (reason === "TYPE" && l.category) {
    r.avoidCategories = add(r.avoidCategories, l.category);
    return { rules: r, learned: `sem ${l.category.toLowerCase()}` };
  }
  if (reason === "SMALL" && l.bedrooms) {
    r.minBedrooms = Math.max(r.minBedrooms ?? 0, l.bedrooms + 1);
    return { rules: r, learned: `com ${r.minBedrooms}+ quartos` };
  }
  if (reason === "GARAGE") {
    r.needsGarage = true;
    return { rules: r, learned: "com vaga de garagem" };
  }
  return { rules: r, learned: null };
}

/** Resumo do que o app aprendeu (para mostrar na tela). */
export function describeRules(rules: LearnedRules | null | undefined) {
  if (!rules) return [];
  return [
    rules.priceCapCents ? `até ${brlShort(rules.priceCapCents)}` : null,
    rules.minBedrooms ? `${rules.minBedrooms}+ quartos` : null,
    rules.needsGarage ? "com garagem" : null,
    ...(rules.avoidAreas ?? []).map((a) => `sem ${a}`),
    ...(rules.avoidCategories ?? []).map((c) => `sem ${c.toLowerCase()}`),
  ].filter((x): x is string => !!x);
}

export const listingLine = (l: RejectedListing) => [l.category, l.neighborhood, l.bedrooms ? `${l.bedrooms} quartos` : null, l.priceCents ? brlShort(l.priceCents) : null].filter(Boolean).join(" · ");
