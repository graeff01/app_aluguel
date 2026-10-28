/**
 * Vigia do site da imobiliária (rodado pelo worker):
 * 1. pedidos do Radar e Clientes em busca: uma vez por dia o app refaz a busca do perfil; imóvel que apareceu desde a
 *    última conferência vira "novo no site" e quem cuida é avisado (pré-atendimento no radar, consultora na busca);
 * 2. visitas de hoje e amanhã: o anúncio do imóvel saiu do site (404)? Avisa o pré-atendimento e a consultora antes
 *    da visita (pode ter sido alugado), com opções parecidas para trocar.
 * Avisos não levam dados do cliente.
 */
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { getSettings } from "@/lib/settings";
import { addDays, dayKey, endOfDayInTz, startOfDayInTz, TZ } from "@/lib/time";
import { notifyUser } from "./notify";
import { fetchPreview, propertyUrl } from "./property-preview";
import { findSimilarOnSite, hasProfile, normText, TYPE_SEARCH } from "./site-search";
import { notFound } from "@/lib/errors";
import { assert, hasGlobalView, isPreService, type AuthzActor } from "@/lib/authz";

type Notify = (userId: string, payload: { title: string; body: string; url: string; tag: string }) => Promise<unknown>;
type Opts = { fetchImpl?: typeof fetch; origin?: string; notify?: Notify; limit?: number; force?: boolean };

const localHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(d));
/** A partir desta hora (Brasília) o vigia roda no dia. */
export const WATCH_FROM_HOUR = 8;
const MAX_SEEN = 300;

/** Compara a busca de hoje com o que já foi visto: o que é novo (na 1ª conferência, nada é "novo"). */
export function diffSeen(prev: { siteSeenCodes: string[]; siteCheckedAt: Date | null }, codes: string[]) {
  const newOnes = prev.siteCheckedAt ? codes.filter((c) => !prev.siteSeenCodes.includes(c)) : [];
  return { newOnes, seen: [...new Set([...prev.siteSeenCodes, ...codes])].slice(-MAX_SEEN) };
}

/** Radar e Clientes em busca: imóveis novos no site com o perfil de cada pedido. */
export async function watchDemandOnSite(now = new Date(), opts: Opts = {}) {
  if (!opts.force && localHour(now) < WATCH_FROM_HOUR) return { radar: 0, searches: 0 };
  const notify = opts.notify ?? notifyUser;
  const dayStart = startOfDayInTz(dayKey(now));
  const pending = { OR: [{ siteCheckedAt: null }, { siteCheckedAt: { lt: dayStart } }] };
  const limit = opts.limit ?? 15;
  const find = (p: Parameters<typeof findSimilarOnSite>[0]) => findSimilarOnSite(p, { fetchImpl: opts.fetchImpl, origin: opts.origin, limit: 20 });
  const day = dayKey(now);

  // radar (pré-atendimento)
  const radars = await db.clientRadar.findMany({ where: { status: { in: ["SEARCHING", "FOUND"] }, ...pending }, orderBy: { createdAt: "asc" }, take: limit });
  let radarWithNew = 0;
  for (const r of radars) {
    if (!hasProfile(r)) {
      await db.clientRadar.update({ where: { id: r.id }, data: { siteCheckedAt: now } });
      continue;
    }
    const res = await find({ ...r, exclude: r.foundCodes });
    if (res.error) continue; // site fora: tenta na próxima rodada
    const { newOnes, seen } = diffSeen(r, res.items.map((i) => i.code));
    await db.$transaction(async (tx) => {
      await tx.clientRadar.update({ where: { id: r.id }, data: { siteSeenCodes: seen, siteNewCodes: newOnes, siteCheckedAt: now } });
      if (newOnes.length) await tx.radarEvent.create({ data: { radarId: r.id, note: `Novo no site com o perfil: ${newOnes.join(", ")}`, createdAt: now } });
    });
    if (newOnes.length) radarWithNew++;
  }
  if (radarWithNew) {
    const pre = await db.user.findMany({ where: { role: "PRE_SERVICE", active: true }, select: { id: true } });
    for (const u of pre)
      await notify(u.id, { title: "Imóvel novo no site para o radar", body: `${radarWithNew === 1 ? "1 pedido tem" : `${radarWithNew} pedidos têm`} opção nova com o perfil pedido. Toque para ver.`, url: "/radar?aba=novos", tag: `radar-novos-${day}` }).catch(() => undefined);
  }

  // clientes em busca (consultora)
  const searches = await db.clientSearch.findMany({ where: { status: "ACTIVE", ...pending }, orderBy: { startedAt: "asc" }, take: limit });
  const perConsultant = new Map<string, string[]>();
  for (const s of searches) {
    if (!hasProfile(s)) {
      await db.clientSearch.update({ where: { id: s.id }, data: { siteCheckedAt: now } });
      continue;
    }
    // imóveis que o cliente já visitou não voltam como sugestão
    const visited = (await db.visit.findMany({ where: { clientId: s.clientId, propertyCode: { not: null } }, select: { propertyCode: true } })).map((v) => v.propertyCode!);
    const res = await find({ ...s, exclude: [...s.sentCodes, ...visited] });
    if (res.error) continue;
    const { newOnes, seen } = diffSeen(s, res.items.map((i) => i.code));
    await db.clientSearch.update({ where: { id: s.id }, data: { siteSeenCodes: seen, siteNewCodes: newOnes, siteCheckedAt: now } });
    if (newOnes.length) perConsultant.set(s.consultantId, [...(perConsultant.get(s.consultantId) ?? []), s.id]);
  }
  for (const [uid, ids] of perConsultant)
    await notify(uid, { title: "Imóvel novo no site para seu cliente em busca", body: `${ids.length === 1 ? "1 cliente em busca tem" : `${ids.length} clientes em busca têm`} opção nova com o perfil. Toque para ver.`, url: ids.length === 1 ? `/em-busca/${ids[0]}` : "/em-busca", tag: `busca-novos-${day}` }).catch(() => undefined);

  if (radarWithNew || perConsultant.size) log.info("site_watch.new_listings", { radar: radarWithNew, buscas: [...perConsultant.values()].flat().length });
  return { radar: radarWithNew, searches: [...perConsultant.values()].flat().length };
}

/** Anúncio confirmado no ar há menos que isto: não consulta o site de novo. */
const FRESH_MS = 6 * 3600_000;

/**
 * Visitas de hoje e amanhã: o anúncio do imóvel saiu do site? Só conta imóvel que já esteve no ar (o código existe
 * no site); cada visita é avisada uma vez.
 */
export async function checkVisitListings(now = new Date(), opts: Opts = {}) {
  if (!opts.force && localHour(now) < WATCH_FROM_HOUR - 1) return { gone: 0 };
  const settings = await getSettings();
  if (!settings.propertyUrlTemplate.includes("{codigo}")) return { gone: 0 };
  const notify = opts.notify ?? notifyUser;
  const visits = await db.visit.findMany({
    where: { status: "SCHEDULED", excluded: false, listingGoneAt: null, propertyCode: { not: null }, scheduledStart: { gte: now, lt: endOfDayInTz(addDays(dayKey(now), 1)) } },
    select: { id: true, propertyCode: true, consultantId: true, scheduledStart: true },
    orderBy: { scheduledStart: "asc" },
  });
  const codes = [...new Set(visits.map((v) => v.propertyCode!))].slice(0, opts.limit ?? 25);
  const props = await db.property.findMany({ where: { code: { in: codes } }, select: { code: true, pageStatus: true, pageCheckedAt: true, title: true, photoUrl: true } });
  const goneCodes: string[] = [];
  for (const code of codes) {
    const p = props.find((x) => x.code === code);
    // só imóvel que já esteve no ar: código que nunca existiu no site não vira alarme
    if (!p || (!p.title && !p.photoUrl)) continue;
    if (p.pageStatus === "OK" && p.pageCheckedAt && now.getTime() - p.pageCheckedAt.getTime() < FRESH_MS) continue;
    const pv = await fetchPreview(propertyUrl(settings.propertyUrlTemplate, code), opts.fetchImpl, code);
    if (pv.status === "ERROR") continue;
    await db.property.update({ where: { code }, data: { pageStatus: pv.status, pageCheckedAt: now } });
    if (pv.status === "NOT_FOUND") goneCodes.push(code);
  }
  if (!goneCodes.length) return { gone: 0 };
  const pre = await db.user.findMany({ where: { role: "PRE_SERVICE", active: true }, select: { id: true } });
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  let gone = 0;
  for (const v of visits.filter((x) => goneCodes.includes(x.propertyCode!))) {
    await db.visit.update({ where: { id: v.id }, data: { listingGoneAt: now } });
    await db.visitOutcomeHistory.create({ data: { visitId: v.id, status: "SCHEDULED", note: `Anúncio do imóvel ${v.propertyCode} saiu do site (pode ter sido alugado)` } });
    gone++;
    const body = `Visita de ${fmt.format(v.scheduledStart)}. Confirme se o imóvel ainda está disponível; se não, troque por uma opção parecida.`;
    if (v.consultantId) await notify(v.consultantId, { title: `Anúncio saiu do site: imóvel ${v.propertyCode}`, body, url: `/visitas/${v.id}`, tag: `anuncio-${v.id}` }).catch(() => undefined);
    for (const u of pre) await notify(u.id, { title: `Anúncio saiu do site: imóvel ${v.propertyCode}`, body, url: `/agenda-do-dia/${v.id}/opcoes`, tag: `anuncio-${v.id}` }).catch(() => undefined);
  }
  log.info("site_watch.listing_gone", { visitas: gone, imoveis: goneCodes.length });
  return { gone };
}

/** Tipo do perfil a partir da categoria do anúncio ("Casa em Condomínio" → Casa). */
export function profileTypeOf(category: string | null) {
  const c = normText(category ?? "");
  for (const [type, t] of Object.entries(TYPE_SEARCH)) if (t.words.some((w) => new RegExp(`\\b${w}\\b`).test(c))) return type;
  return null;
}

/**
 * Opções no site parecidas com o imóvel de uma visita (mesmo tipo, bairro, quartos e valor total até 15% acima):
 * para trocar quando o imóvel ficou indisponível. Pré-atendimento e gestão.
 */
export async function alternativesForVisit(actor: AuthzActor, visitId: string, opts: { fetchImpl?: typeof fetch; origin?: string } = {}) {
  assert(isPreService(actor) || hasGlobalView(actor));
  const v = await db.visit.findUnique({
    where: { id: visitId },
    select: { id: true, status: true, swappedTo: true, propertyCode: true, companionOfId: true, clientName: true, scheduledStart: true, listingGoneAt: true, consultant: { select: { name: true } }, property: { select: { title: true, photoUrl: true, category: true, neighborhood: true, bedrooms: true, rent: true, totalPrice: true } } },
  });
  if (!v) throw notFound();
  const groupId = v.companionOfId ?? v.id;
  const group = await db.visit.findMany({ where: { OR: [{ id: groupId }, { companionOfId: groupId }] }, select: { propertyCode: true } });
  const p = v.property;
  const price = p?.totalPrice ?? p?.rent ?? null;
  const profile = { propertyType: profileTypeOf(p?.category ?? null), areas: p?.neighborhood ? [p.neighborhood] : [], bedrooms: p?.bedrooms ?? null, maxBudgetCents: price ? Math.round(price * 100 * 1.15) : null };
  const result = await findSimilarOnSite({ ...profile, exclude: group.map((g) => g.propertyCode).filter((c): c is string => !!c) }, { ...opts, limit: 8 });
  return { visit: v, profile, result };
}
