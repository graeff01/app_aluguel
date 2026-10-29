/**
 * "Quanto rende o seu imóvel?": página pública para proprietários (sem login).
 * - Estimativa: aluguel dos imóveis parecidos no nosso site e quantos clientes nossos procuram esse perfil agora
 *   (só contagens e valores: nenhum dado de cliente sai daqui).
 * - Contato: o proprietário deixa nome e WhatsApp (com consentimento) e vira um contato para a captação, com aviso.
 * - Captação: lista, "vou atender", situação (em contato → avaliou → captado / não fechou) e retenção LGPD.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, hasGlobalView, isCapture, type AuthzActor } from "@/lib/authz";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { normalizePhone } from "@/lib/phone";
import { hitRateLimit } from "@/lib/ratelimit";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/log";
import { phoneHash } from "./client-links";
import { PROPERTY_TYPES } from "./client-search";
import { normText, profileQuery, searchSitePage, siteSearchUrl, siteOrigin, type SiteListing } from "./site-search";
import { sendAlerts, usersWithRole } from "./alerts";
import { notifyUser } from "./notify";

const DAY = 86400_000;
export const OWNER_TYPES = PROPERTY_TYPES;

export const LEAD_STATUS = { NEW: "Novo", CONTACTED: "Em contato", VISITED: "Avaliou o imóvel", CAPTURED: "Captado", LOST: "Não fechou" } as const;
export type LeadStatus = keyof typeof LEAD_STATUS;
const CLOSED: LeadStatus[] = ["CAPTURED", "LOST"];

export const canSeeOwnerLeads = (a: AuthzActor) => isCapture(a) || hasGlobalView(a);

// ─────────────── Estimativa ───────────────

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return Math.round(s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo));
};
const roundTo = (cents: number, step = 5000) => Math.round(cents / step) * step;

/** Tira valores fora da realidade de aluguel (anúncio com erro, venda): faixa plausível e, com vários, o que passa de 2,5× ou fica abaixo de 40% da mediana. */
export function saneRents(rents: number[]) {
  const plausible = rents.filter((c) => c >= 30_000 && c <= 3_000_000);
  if (plausible.length < 4) return plausible;
  const med = quantile(plausible, 0.5);
  return plausible.filter((c) => c <= med * 2.5 && c >= med * 0.4);
}

export type OwnerProfile = { area: string; propertyType: string; bedrooms: number | null };
const profileSchema = z.object({
  area: z.string().trim().min(2, "Informe o bairro.").max(60),
  propertyType: z.enum(OWNER_TYPES, { message: "Escolha o tipo." }),
  bedrooms: z.coerce.number().int().min(0).max(10).nullable(),
});

/** Imóveis parecidos (mesmo tipo e quartos): no bairro; com poucos, na cidade toda. */
async function comparables(p: OwnerProfile, opts: { fetchImpl?: typeof fetch; origin?: string }) {
  const base = profileQuery({ propertyType: p.propertyType, bedrooms: p.bedrooms, maxBudgetCents: null, areas: [] });
  const same = (l: SiteListing) => p.bedrooms == null || l.bedrooms == null || l.bedrooms === p.bedrooms || (p.bedrooms >= 4 && l.bedrooms >= 4);
  const priced = (ls: SiteListing[]) => ls.filter((l) => same(l) && (l.rentCents ?? 0) > 0);
  const inArea = await searchSitePage({ ...base, area: p.area }, opts);
  let items = priced(inArea?.items ?? []);
  let scope: "area" | "city" = "area";
  let url = siteSearchUrl(opts.origin!, { ...base, area: p.area });
  if (items.length < 3) {
    const city = await searchSitePage(base, opts);
    const cityItems = priced(city?.items ?? []);
    if (cityItems.length > items.length) {
      items = cityItems;
      scope = "city";
      url = siteSearchUrl(opts.origin!, base);
    }
  }
  return { items, scope, url, error: inArea === null };
}

/** Clientes com pedido em aberto ou em busca que aceitariam esse imóvel (bairro, tipo e quartos). */
async function demandFor(p: OwnerProfile) {
  const key = normText(p.area);
  const fits = (r: { areas: string[]; propertyType: string | null; bedrooms: number | null }) =>
    r.areas.some((a) => normText(a) === key) && (!r.propertyType || r.propertyType === p.propertyType) && (r.bedrooms == null || p.bedrooms == null || r.bedrooms <= p.bedrooms);
  const [radars, searches] = await Promise.all([
    db.clientRadar.findMany({ where: { searchId: null, status: { in: ["SEARCHING", "FOUND"] } }, select: { areas: true, propertyType: true, bedrooms: true, maxBudgetCents: true } }),
    db.clientSearch.findMany({ where: { status: "ACTIVE" }, select: { areas: true, propertyType: true, bedrooms: true, maxBudgetCents: true } }),
  ]);
  const match = [...radars, ...searches].filter(fits);
  const budgets = match.map((m) => m.maxBudgetCents).filter((x): x is number => !!x);
  return { count: match.length, budgetCents: budgets.length ? quantile(budgets, 0.5) : null };
}

/** Estimativa para o proprietário (página pública, com limite por IP). */
export async function ownerEstimate(input: { area: string; propertyType: string; bedrooms?: string | number | null }, ip: string, opts: { fetchImpl?: typeof fetch; origin?: string } = {}) {
  const parsed = profileSchema.safeParse({ ...input, bedrooms: input.bedrooms === "" || input.bedrooms == null ? null : input.bedrooms });
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Revise os campos.");
  const rl = await hitRateLimit(`owner-estimate:${ip}`, 30, 3600);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", "Muitas consultas seguidas. Tente de novo em alguns minutos.");
  const p = parsed.data;
  const origin = opts.origin ?? (await siteOrigin());
  const [comp, demand] = await Promise.all([comparables(p, { ...opts, origin }), demandFor(p)]);
  const rents = saneRents(comp.items.map((l) => l.rentCents!));
  const range = rents.length >= 2 ? { low: roundTo(quantile(rents, 0.25)), mid: roundTo(quantile(rents, 0.5)), high: roundTo(quantile(rents, 0.75)) } : rents.length === 1 ? { low: roundTo(rents[0]), mid: roundTo(rents[0]), high: roundTo(rents[0]) } : null;
  return {
    profile: p,
    range,
    sample: rents.length,
    scope: comp.scope,
    examples: comp.items.filter((l) => rents.includes(l.rentCents!)).slice(0, 3).map((l) => ({ code: l.code, rentCents: l.rentCents, neighborhood: l.neighborhood, bedrooms: l.bedrooms, photoUrl: l.photoUrl, url: l.url })),
    demand: demand.count,
    demandBudgetCents: demand.budgetCents ? roundTo(demand.budgetCents) : null,
    siteError: comp.error,
  };
}
export type OwnerEstimate = Awaited<ReturnType<typeof ownerEstimate>>;

// ─────────────── Contato do proprietário ───────────────

const leadSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  phone: z.string().trim().min(8, "Informe seu WhatsApp.").max(40),
  wanted: z.string().max(30).optional(),
  message: z.string().max(600).optional(),
  consent: z.literal(true, { message: "Para falarmos com você, marque a autorização." }),
});

const parseCents = (raw?: string) => {
  const digits = (raw ?? "").replace(/[^\d,]/g, "").replace(/,\d{0,2}$/, "");
  const n = Number(digits.replace(/\D/g, ""));
  return Number.isFinite(n) && n >= 100 && n <= 200000 ? n * 100 : null;
};

/** O proprietário pede o contato: vira um contato para a captação (mesmo WhatsApp em aberto: atualiza). */
export async function createOwnerLead(input: OwnerProfile & { bedrooms: number | null; name: string; phone: string; wanted?: string; message?: string; consent: boolean; estimateCents?: number | null; demand?: number }, ip: string, now = new Date(), notify: typeof notifyUser = notifyUser) {
  const prof = profileSchema.safeParse(input);
  const lead = leadSchema.safeParse(input);
  if (!prof.success || !lead.success) {
    const issues = [...(prof.success ? [] : prof.error.issues), ...(lead.success ? [] : lead.error.issues)];
    throw new AppError("VALIDATION", issues[0]?.message ?? "Revise os campos.", Object.fromEntries(issues.map((i) => [i.path.join("."), i.message])));
  }
  const phone = normalizePhone(lead.data.phone);
  if (!phone.valid || !phone.normalized) throw new AppError("VALIDATION", "Confira o WhatsApp (com DDD).", { phone: "Telefone inválido (DDD + número)." });
  const rl = await hitRateLimit(`owner-lead:${ip}`, 5, 3600);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", "Recebemos vários pedidos seguidos daqui. Tente de novo mais tarde.");
  const hash = phoneHash(phone.normalized);
  const data = {
    name: lead.data.name.replace(/\s+/g, " "),
    phoneEnc: encryptSecret(phone.normalized),
    phoneHash: hash,
    area: prof.data.area.replace(/[\s.,;:!]+$/, ""),
    propertyType: prof.data.propertyType,
    bedrooms: prof.data.bedrooms,
    wantedCents: parseCents(lead.data.wanted),
    estimateCents: input.estimateCents ?? null,
    demand: Math.max(0, Math.min(999, input.demand ?? 0)),
    message: lead.data.message?.trim() || null,
    consentAt: now,
  };
  const open = await db.ownerLead.findFirst({ where: { phoneHash: hash, status: { notIn: CLOSED }, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } } });
  const row = open ? await db.ownerLead.update({ where: { id: open.id }, data }) : await db.ownerLead.create({ data: { ...data, createdAt: now } });
  await db.$transaction((tx) => audit(tx, { actorId: null, action: open ? "owner_lead.updated" : "owner_lead.created", entityType: "OwnerLead", entityId: row.id }));
  const what = [row.propertyType, row.bedrooms != null ? `${row.bedrooms} qto${row.bedrooms === 1 ? "" : "s"}` : null, row.area].filter(Boolean).join(" · ");
  await sendAlerts(await usersWithRole("CAPTURE"), { title: "Proprietário quer alugar com a gente", body: `${what}${row.demand ? ` — ${row.demand} cliente${row.demand > 1 ? "s" : ""} procurando` : ""}. Fale com ele hoje.`, url: "/demanda/proprietarios", tag: `dono-${row.id}` }, { notify, now });
  return row;
}

// ─────────────── Captação ───────────────

export async function listOwnerLeads(actor: AuthzActor, now = new Date()) {
  assert(canSeeOwnerLeads(actor));
  const rows = await db.ownerLead.findMany({
    where: { purgedAt: null, OR: [{ status: { notIn: CLOSED } }, { closedAt: { gte: new Date(now.getTime() - 60 * DAY) } }] },
    orderBy: { createdAt: "desc" },
    include: { handler: { select: { id: true, name: true } } },
    take: 300,
  });
  return rows.map(({ phoneEnc, ...r }) => {
    let phone: string | null = null;
    try {
      phone = phoneEnc ? decryptSecret(phoneEnc) : null;
    } catch {
      phone = null;
    }
    return { ...r, phone, days: Math.max(0, Math.floor((now.getTime() - r.createdAt.getTime()) / DAY)) };
  });
}

export const countNewOwnerLeads = (actor: AuthzActor) => (canSeeOwnerLeads(actor) ? db.ownerLead.count({ where: { status: "NEW", purgedAt: null } }) : Promise.resolve(0));

/** "Vou atender", troca de situação e observação. Captado/Não fechou encerram. */
export async function updateOwnerLead(actor: AuthzActor, id: string, input: { status?: string; note?: string; take?: boolean }, now = new Date()) {
  assert(canSeeOwnerLeads(actor));
  const lead = await db.ownerLead.findUnique({ where: { id } });
  if (!lead || lead.purgedAt) throw notFound();
  const status = input.status as LeadStatus | undefined;
  if (status && !(status in LEAD_STATUS)) throw new AppError("VALIDATION", "Situação inválida.");
  const note = input.note?.trim().slice(0, 600);
  await db.$transaction(async (tx) => {
    await tx.ownerLead.update({
      where: { id },
      data: {
        ...(input.take ? { handlerId: actor.id } : {}),
        ...(status ? { status, closedAt: CLOSED.includes(status) ? now : null } : {}),
        // primeiro passo do atendimento: quem mexe vira o responsável
        ...(!lead.handlerId && !input.take && status ? { handlerId: actor.id } : {}),
        ...(note !== undefined ? { note: note || null } : {}),
      },
    });
    await audit(tx, { actorId: actor.id, action: "owner_lead.updated", entityType: "OwnerLead", entityId: id, changes: { situacao: status ?? null } });
  });
}

/** LGPD: contatos encerrados há mais que o prazo da pré-análise perdem nome e telefone. */
export async function runOwnerLeadRetention(now = new Date()) {
  const settings = await getSettings();
  const limit = new Date(now.getTime() - settings.preAnalysisRetentionDays * DAY);
  const r = await db.ownerLead.updateMany({ where: { purgedAt: null, status: { in: CLOSED }, closedAt: { lt: limit } }, data: { name: "Proprietário (dados apagados)", phoneEnc: null, phoneHash: null, message: null, purgedAt: now } });
  if (r.count) log.info("owner_lead.purged", { count: r.count });
  return { purged: r.count };
}
