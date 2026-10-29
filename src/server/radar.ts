/**
 * Radar de clientes: o cliente procura um perfil que não temos na base; o pré-atendimento passa o pedido à captação
 * e acompanha aqui até o fim, para não cair no esquecimento.
 *
 * - cada pedido tem o dia de cobrar (a captação ou o retorno ao cliente); vencido, aparece em "Cobrar hoje" e o
 *   pré-atendimento recebe um aviso por dia;
 * - atualizações ficam no histórico; quando a captação acha imóvel(is), os códigos ficam registrados;
 * - termina com o resultado (agendou visita, alugou, desistiu, captação não achou).
 *
 * LGPD: telefone cifrado (AES-256-GCM) + impressão (HMAC) para ligar ao cadastro; apagado no mesmo prazo da
 * pré-análise depois de encerrado. Notificações não levam dados do cliente.
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { assert, hasGlobalView, isCapture, isPreService, type AuthzActor } from "@/lib/authz";
import { notifyUser } from "./notify";
import { sendAlerts, usersWithRole } from "./alerts";
import { normalizePhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/log";
import { addDays, dateOnlyFromKey, dateOnlyKey, dayKey } from "@/lib/time";
import { clientByPhone, phoneHash } from "./client-links";
import { parseProfile } from "./client-search";
import { findSimilarOnSite, learnFromRejection, listingLine, REJECT_REASONS, type LearnedRules, type RejectReason, type RejectedListing } from "./site-search";
import type { RadarStatus } from "@/generated/prisma/enums";

const DAY = 86400_000;
export const RADAR_FOLLOWUP_DAYS = 3;
export const OPEN_RADAR: RadarStatus[] = ["SEARCHING", "FOUND"];

export const RADAR_STATUS_LABEL: Record<RadarStatus, string> = {
  SEARCHING: "Com a captação",
  FOUND: "Imóvel encontrado",
  CLOSED: "Encerrado",
};

export const RADAR_CLOSE_REASONS = ["Agendou visita", "Alugou conosco", "Alugou em outro lugar", "Desistiu / parou de responder", "Captação não encontrou"] as const;

export const canUseRadar = (a: AuthzActor) => isPreService(a) || hasGlobalView(a);

const codesOf = (raw: string) => [...new Set(raw.split(/[\s;,]+/).map((c) => c.trim()).filter(Boolean))];
const followDays = (v: string | number | undefined) => {
  const n = Math.round(Number(v ?? RADAR_FOLLOWUP_DAYS));
  return Number.isFinite(n) && n >= 1 && n <= 30 ? n : RADAR_FOLLOWUP_DAYS;
};

const createSchema = z.object({
  clientName: z.string().trim().min(2, "Informe o nome do cliente.").max(160),
  phone: z.string().trim().min(1, "Informe o telefone.").max(40),
  wants: z.string().trim().min(5, "Conte o que o cliente procura.").max(1500),
  maxBudget: z.string().max(30).optional(),
  areas: z.string().max(300).optional(),
  propertyType: z.string().max(40).optional(),
  bedrooms: z.string().max(2).optional(),
  sentToCapture: z.boolean().optional().default(true),
  followUpDays: z.union([z.string(), z.number()]).optional(),
  requestId: z.string().max(100).optional(),
});

export async function createRadar(actor: AuthzActor, input: z.input<typeof createSchema>, now = new Date()) {
  assert(canUseRadar(actor));
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Revise os campos destacados.", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
  const p = parsed.data;
  if (p.requestId) {
    const dup = await db.clientRadar.findUnique({ where: { requestId: p.requestId } });
    if (dup) return dup;
  }
  const phone = normalizePhone(p.phone);
  if (!phone.valid || !phone.normalized) throw new AppError("VALIDATION", "Revise os campos destacados.", { phone: "Telefone inválido (DDD + número)." });
  const profile = parseProfile({ maxBudget: p.maxBudget, areas: p.areas, propertyType: p.propertyType, bedrooms: p.bedrooms });
  const created = await db.$transaction(async (tx) => {
    const row = await tx.clientRadar.create({
      data: {
        requestId: p.requestId || null,
        createdById: actor.id,
        clientName: p.clientName.replace(/\s+/g, " "),
        phoneEnc: encryptSecret(phone.normalized!),
        phoneHash: phoneHash(phone.normalized!),
        clientId: await clientByPhone(tx, phone.normalized!),
        wants: p.wants,
        maxBudgetCents: (profile.maxBudgetCents as number | null | undefined) ?? null,
        areas: (profile.areas as string[] | undefined) ?? [],
        propertyType: (profile.propertyType as string | null | undefined) ?? null,
        bedrooms: (profile.bedrooms as number | null | undefined) ?? null,
        sentToCaptureAt: p.sentToCapture ? now : null,
        followUpOn: dateOnlyFromKey(addDays(dayKey(now), followDays(p.followUpDays))),
        lastUpdateAt: now,
        createdAt: now,
        events: { create: { note: p.sentToCapture ? "Cadastrado no radar e passado à captação." : "Cadastrado no radar.", authorId: actor.id, createdAt: now } },
      },
    });
    await audit(tx, { actorId: actor.id, action: "radar.created", entityType: "ClientRadar", entityId: row.id });
    return row;
  });
  if (created.sentToCaptureAt) await notifyCaptureNewRequest(created.id);
  return created;
}

export type RadarTab = "cobrar" | "novos" | "abertos" | "encerrados";

export async function listRadar(actor: AuthzActor, f: { tab: RadarTab; q?: string }, now = new Date()) {
  assert(canUseRadar(actor));
  const today = dateOnlyFromKey(dayKey(now));
  const q = f.q?.trim();
  return db.clientRadar.findMany({
    where: {
      ...(f.tab === "encerrados" ? { status: "CLOSED" as const } : { status: { in: OPEN_RADAR } }),
      ...(f.tab === "cobrar" ? { followUpOn: { lte: today } } : {}),
      ...(f.tab === "novos" ? { siteNewCodes: { isEmpty: false } } : {}),
      ...(q ? { OR: [{ clientName: { contains: q, mode: "insensitive" as const } }, { wants: { contains: q, mode: "insensitive" as const } }, { foundCodes: { has: q } }] } : {}),
    },
    orderBy: f.tab === "encerrados" ? { closedAt: "desc" } : [{ followUpOn: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: { id: true, clientName: true, wants: true, status: true, followUpOn: true, sentToCaptureAt: true, foundCodes: true, createdAt: true, lastUpdateAt: true, closedAt: true, closeReason: true, siteNewCodes: true, maxBudgetCents: true, areas: true, propertyType: true, bedrooms: true, createdBy: { select: { name: true } } },
  });
}

/** Quantos pedidos do radar vencem hoje (ou já venceram): número no menu. */
export async function countDueRadar(actor: AuthzActor, now = new Date()) {
  if (!canUseRadar(actor)) return 0;
  return db.clientRadar.count({ where: { status: { in: OPEN_RADAR }, followUpOn: { lte: dateOnlyFromKey(dayKey(now)) } } });
}

export async function radarDetail(actor: AuthzActor, id: string) {
  assert(canUseRadar(actor));
  const r = await db.clientRadar.findUnique({
    where: { id },
    include: { createdBy: { select: { name: true } }, closedBy: { select: { name: true } }, events: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } } },
  });
  if (!r) throw notFound();
  let phone: string | null = null;
  if (r.phoneEnc) {
    try {
      phone = decryptSecret(r.phoneEnc);
    } catch {
      phone = null;
    }
  }
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "radar.viewed", entityType: "ClientRadar", entityId: id }));
  return { ...r, phone };
}

/**
 * Atualização: o que aconteceu, quando cobrar de novo e, se a captação achou, os códigos.
 * "Passei à captação" marca a data de envio (para quem cadastrou antes de passar).
 */
export async function updateRadar(actor: AuthzActor, id: string, input: { note: string; followUpDays?: string | number; foundCodes?: string; sentToCapture?: boolean; foundLabel?: string }, now = new Date()) {
  assert(canUseRadar(actor));
  const note = input.note.trim().slice(0, 1500);
  if (note.length < 3) throw new AppError("VALIDATION", "Conte o que aconteceu.", { note: "Obrigatório." });
  const codes = codesOf(input.foundCodes ?? "");
  if (codes.some((c) => !/^[\w-]{2,40}$/.test(c))) throw new AppError("VALIDATION", "Confira os códigos dos imóveis.", { foundCodes: "Código inválido (vários: separe com ;)." });
  const sentNow = await db.$transaction(async (tx) => {
    const r = await tx.clientRadar.findUnique({ where: { id } });
    if (!r) throw notFound();
    if (r.status === "CLOSED") throw new AppError("INVALID_STATE", "Este pedido está encerrado. Reabra para atualizar.");
    const found = [...new Set([...r.foundCodes, ...codes])].slice(0, 12);
    const markSent = !!input.sentToCapture && !r.sentToCaptureAt;
    await tx.clientRadar.update({
      where: { id },
      data: {
        lastUpdateAt: now,
        followUpOn: dateOnlyFromKey(addDays(dayKey(now), followDays(input.followUpDays))),
        ...(codes.length ? { foundCodes: found, status: "FOUND" as const, siteNewCodes: r.siteNewCodes.filter((c) => !codes.includes(c)) } : {}),
        ...(markSent ? { sentToCaptureAt: now } : {}),
      },
    });
    const extra = [markSent ? "Passado à captação." : "", codes.length ? `${input.foundLabel ?? "Captação achou"}: ${codes.join(", ")}.` : ""].filter(Boolean).join(" ");
    await tx.radarEvent.create({ data: { radarId: id, note: [extra, note].filter(Boolean).join(" — ").slice(0, 2000), authorId: actor.id, createdAt: now } });
    await audit(tx, { actorId: actor.id, action: "radar.updated", entityType: "ClientRadar", entityId: id, changes: codes.length ? { imoveis: codes } : undefined });
    return { markSent, r };
  });
  if (sentNow.markSent) await notifyCaptureNewRequest(id);
  // pedido que já está com a captação: ela fica sabendo (sem o texto, que pode ter dados do cliente)
  else if (sentNow.r.sentToCaptureAt)
    await alertCapture(id, sentNow.r, "Pedido atualizado pelo atendimento", codes.length ? `${input.foundLabel ?? "Imóveis indicados"}: ${codes.join(", ")}` : "Nova conversa com o cliente registrada", actor.id);
}

/** Avisa a captação (aviso no app + celular) sobre um pedido que está com ela. Um aviso por pedido até ser lido. */
async function alertCapture(radarId: string, r: Parameters<typeof profileLine>[0], title: string, what: string, exclude?: string, notify?: typeof notifyUser) {
  await sendAlerts(await usersWithRole("CAPTURE"), { title, body: `${profileLine(r)} — ${what}`, url: "/demanda/pedidos", tag: `captacao-${radarId}` }, { exclude, notify });
}

/** Avisa quem atende o pedido (quem cadastrou e o pré-atendimento) sobre algo da captação. */
export async function alertRadarTeam(r: { id: string; createdById: string }, p: { title: string; body: string; tag: string }, exclude?: string, notify?: typeof notifyUser) {
  await sendAlerts([r.createdById, ...(await usersWithRole("PRE_SERVICE"))], { ...p, url: `/radar/${r.id}` }, { exclude, notify });
}

export async function closeRadar(actor: AuthzActor, id: string, input: { reason: string; note?: string }, now = new Date()) {
  assert(canUseRadar(actor));
  if (!(RADAR_CLOSE_REASONS as readonly string[]).includes(input.reason)) throw new AppError("VALIDATION", "Escolha como terminou.", { reason: "Obrigatório." });
  const note = (input.note ?? "").trim().slice(0, 1000) || null;
  const r = await db.$transaction(async (tx) => {
    const r = await tx.clientRadar.findUnique({ where: { id } });
    if (!r) throw notFound();
    if (r.status === "CLOSED") throw new AppError("INVALID_STATE", "Este pedido já está encerrado.");
    await tx.clientRadar.update({ where: { id }, data: { status: "CLOSED", closedAt: now, closedById: actor.id, closeReason: input.reason, closeNote: note, lastUpdateAt: now } });
    await tx.radarEvent.create({ data: { radarId: id, note: `Encerrado: ${input.reason}${note ? ` — ${note}` : ""}`, authorId: actor.id, createdAt: now } });
    await audit(tx, { actorId: actor.id, action: "radar.closed", entityType: "ClientRadar", entityId: id, changes: { resultado: input.reason } });
    return r;
  });
  if (r.sentToCaptureAt) await alertCapture(id, r, "Pedido encerrado: pode parar a busca", input.reason, actor.id);
}

export async function reopenRadar(actor: AuthzActor, id: string, now = new Date()) {
  assert(canUseRadar(actor));
  const r = await db.$transaction(async (tx) => {
    const r = await tx.clientRadar.findUnique({ where: { id } });
    if (!r) throw notFound();
    if (r.status !== "CLOSED") throw new AppError("INVALID_STATE", "Este pedido está em aberto.");
    if (r.purgedAt) throw new AppError("INVALID_STATE", "Os dados deste pedido já foram apagados (LGPD). Cadastre de novo.");
    await tx.clientRadar.update({
      where: { id },
      data: { status: r.foundCodes.length ? "FOUND" : "SEARCHING", closedAt: null, closedById: null, closeReason: null, closeNote: null, lastUpdateAt: now, followUpOn: dateOnlyFromKey(addDays(dayKey(now), 1)) },
    });
    await tx.radarEvent.create({ data: { radarId: id, note: "Reaberto.", authorId: actor.id, createdAt: now } });
    await audit(tx, { actorId: actor.id, action: "radar.reopened", entityType: "ClientRadar", entityId: id });
    return r;
  });
  if (r.sentToCaptureAt) await alertCapture(id, r, "Pedido reaberto: o cliente ainda procura", "voltou para a busca", actor.id);
}

/** Dias desde que passou à captação (ou desde o cadastro). */
export const radarAgeDays = (r: { sentToCaptureAt: Date | null; createdAt: Date }, now = new Date()) => Math.max(0, Math.floor((now.getTime() - (r.sentToCaptureAt ?? r.createdAt).getTime()) / DAY));
export const isRadarDue = (r: { status: RadarStatus; followUpOn: Date }, now = new Date()) => r.status !== "CLOSED" && dateOnlyKey(r.followUpOn) <= dayKey(now);

/** LGPD: telefone de pedidos encerrados há mais que o prazo da pré-análise é apagado. */
export async function runRadarRetention(now = new Date()) {
  const settings = await getSettings();
  const limit = new Date(now.getTime() - settings.preAnalysisRetentionDays * DAY);
  const r = await db.clientRadar.updateMany({ where: { purgedAt: null, status: "CLOSED", closedAt: { lt: limit } }, data: { phoneEnc: null, phoneHash: null, purgedAt: now } });
  if (r.count) {
    log.info("radar.purged", { count: r.count });
    await db.$transaction((tx) => audit(tx, { actorId: null, action: "radar.purged", entityType: "ClientRadar", entityId: "-", changes: { quantidade: r.count, dias: settings.preAnalysisRetentionDays } }));
  }
  return { purged: r.count };
}

// ─────────────── Opções parecidas no site ───────────────

/** Imóveis do site parecidos com o perfil do pedido (ver findSimilarOnSite). */
export async function similarOnSite(
  actor: AuthzActor,
  radar: { maxBudgetCents: number | null; areas: string[]; propertyType: string | null; bedrooms: number | null; foundCodes: string[]; rejectedCodes?: string[]; siteRules?: unknown },
  opts: { fetchImpl?: typeof fetch; origin?: string; limit?: number } = {},
) {
  assert(canUseRadar(actor));
  return findSimilarOnSite({ ...radar, exclude: [...radar.foundCodes, ...(radar.rejectedCodes ?? [])], rules: radar.siteRules as LearnedRules | null }, opts);
}

/** Indica ao pedido um imóvel sugerido (fica nos imóveis achados e no histórico). */
export async function addSuggestedToRadar(actor: AuthzActor, id: string, code: string, now = new Date()) {
  if (!/^[\w-]{2,40}$/.test(code)) throw new AppError("VALIDATION", "Código inválido.");
  return updateRadar(actor, id, { note: "Indicada ao cliente a partir das opções parecidas do site.", foundCodes: code, followUpDays: 2, foundLabel: "Opção da base" }, now);
}

/** Opções enviadas ao cliente pelo WhatsApp (ou mostradas): ficam nos imóveis do pedido e no histórico. */
export async function radarOptionsSent(actor: AuthzActor, id: string, codes: string[], via: "whatsapp" | "manual", now = new Date()) {
  const list = [...new Set(codes)].filter((c) => /^[\w-]{2,40}$/.test(c)).slice(0, 6);
  if (!list.length) throw new AppError("VALIDATION", "Escolha ao menos uma opção.");
  return updateRadar(actor, id, { note: via === "whatsapp" ? "Opções enviadas ao cliente pelo WhatsApp." : "Opções indicadas ao cliente.", foundCodes: list.join(";"), followUpDays: 2, foundLabel: "Opções do site para o cliente" }, now);
}

// ─────────────── Captação ───────────────

const profileLine = (r: { propertyType: string | null; bedrooms: number | null; areas: string[]; maxBudgetCents: number | null }) =>
  [r.propertyType ?? "Imóvel", r.bedrooms ? `${r.bedrooms}+ quartos` : null, r.areas.length ? r.areas.join(", ") : null, r.maxBudgetCents ? `até ${(r.maxBudgetCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}` : null].filter(Boolean).join(" · ");

/** Avisa a captação de um pedido novo (só o perfil: nenhum dado do cliente). */
export async function notifyCaptureNewRequest(radarId: string, notify: typeof notifyUser = notifyUser) {
  const r = await db.clientRadar.findUnique({ where: { id: radarId }, select: { propertyType: true, bedrooms: true, areas: true, maxBudgetCents: true } });
  if (!r) return;
  await sendAlerts(await usersWithRole("CAPTURE"), { title: "Novo pedido para a captação", body: profileLine(r), url: "/demanda/pedidos", tag: `captacao-${radarId}` }, { notify });
}

/**
 * A captação achou imóvel(is) para um pedido: entram nos imóveis do pedido, o pedido vai para "Cobrar hoje" do
 * pré-atendimento (para oferecer ao cliente) e o pré-atendimento é avisado.
 */
export async function captureFound(actor: AuthzActor, id: string, input: { codes: string; note?: string }, now = new Date(), notify: typeof notifyUser = notifyUser) {
  assert(isCapture(actor) || hasGlobalView(actor));
  const codes = codesOf(input.codes);
  if (!codes.length || codes.some((c) => !/^[\w-]{2,40}$/.test(c))) throw new AppError("VALIDATION", "Informe o código do imóvel.", { codes: "Código inválido (vários: separe com ;)." });
  const note = (input.note ?? "").trim().slice(0, 500);
  const r = await db.clientRadar.findUnique({ where: { id } });
  if (!r || !r.sentToCaptureAt) throw notFound();
  if (r.status === "CLOSED") throw new AppError("INVALID_STATE", "Este pedido já foi encerrado pelo pré-atendimento.");
  await db.$transaction(async (tx) => {
    await tx.clientRadar.update({
      where: { id },
      data: { foundCodes: [...new Set([...r.foundCodes, ...codes])].slice(0, 12), status: "FOUND", siteNewCodes: r.siteNewCodes.filter((c) => !codes.includes(c)), followUpOn: dateOnlyFromKey(dayKey(now)), lastUpdateAt: now },
    });
    await tx.radarEvent.create({ data: { radarId: id, note: [`Captação achou: ${codes.join(", ")}.`, note].filter(Boolean).join(" — "), authorId: actor.id, createdAt: now } });
    await audit(tx, { actorId: actor.id, action: "radar.capture_found", entityType: "ClientRadar", entityId: id, changes: { imoveis: codes } });
  });
  await alertRadarTeam(r, { title: "A captação achou imóvel para o radar", body: `${codes.length === 1 ? `Imóvel ${codes[0]}` : `Imóveis ${codes.join(", ")}`} para o pedido: ${profileLine(r)}. Toque para oferecer ao cliente.`, tag: `radar-achou-${id}` }, actor.id, notify);
}

// ─────────────── "Fora do perfil" ───────────────

/** A opção do site não serve: sai das sugestões e o motivo ajusta as próximas (teto de valor, bairro, tipo…). */
export async function rejectRadarSuggestion(actor: AuthzActor, id: string, input: { reason: string; note?: string; listing: RejectedListing }, now = new Date()) {
  assert(canUseRadar(actor));
  if (!(input.reason in REJECT_REASONS)) throw new AppError("VALIDATION", "Escolha o motivo.", { reason: "Obrigatório." });
  const reason = input.reason as RejectReason;
  const note = (input.note ?? "").trim().slice(0, 300);
  if (reason === "OTHER" && !note) throw new AppError("VALIDATION", "Conte o motivo.", { note: "Obrigatório quando o motivo é Outro." });
  if (!/^[\w-]{2,40}$/.test(input.listing.code)) throw new AppError("VALIDATION", "Código inválido.");
  const r = await db.clientRadar.findUnique({ where: { id } });
  if (!r) throw notFound();
  const { rules, learned } = learnFromRejection(r.siteRules as LearnedRules | null, reason, input.listing);
  await db.$transaction(async (tx) => {
    await tx.clientRadar.update({
      where: { id },
      data: { rejectedCodes: [...new Set([...r.rejectedCodes, input.listing.code])].slice(-200), siteRules: rules, siteNewCodes: r.siteNewCodes.filter((c) => c !== input.listing.code) },
    });
    await tx.radarEvent.create({
      data: { radarId: id, authorId: actor.id, createdAt: now, note: [`Fora do perfil: imóvel ${input.listing.code} (${listingLine(input.listing)}) — ${REJECT_REASONS[reason]}`, note, learned ? `Próximas sugestões: ${learned}.` : ""].filter(Boolean).join(" — ").slice(0, 2000) },
    });
    await audit(tx, { actorId: actor.id, action: "radar.suggestion_rejected", entityType: "ClientRadar", entityId: id, changes: { imovel: input.listing.code, motivo: reason } });
  });
  return { learned };
}

/** Desfaz os ajustes aprendidos (as opções recusadas continuam fora). */
export async function resetRadarRules(actor: AuthzActor, id: string) {
  assert(canUseRadar(actor));
  await db.clientRadar.update({ where: { id }, data: { siteRules: Prisma.DbNull } });
}
