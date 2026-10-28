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
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { assert, hasGlobalView, isPreService, type AuthzActor } from "@/lib/authz";
import { normalizePhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/log";
import { addDays, dateOnlyFromKey, dateOnlyKey, dayKey } from "@/lib/time";
import { clientByPhone, phoneHash } from "./client-links";
import { parseProfile } from "./client-search";
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
  return db.$transaction(async (tx) => {
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
}

export type RadarTab = "cobrar" | "abertos" | "encerrados";

export async function listRadar(actor: AuthzActor, f: { tab: RadarTab; q?: string }, now = new Date()) {
  assert(canUseRadar(actor));
  const today = dateOnlyFromKey(dayKey(now));
  const q = f.q?.trim();
  return db.clientRadar.findMany({
    where: {
      ...(f.tab === "encerrados" ? { status: "CLOSED" as const } : { status: { in: OPEN_RADAR } }),
      ...(f.tab === "cobrar" ? { followUpOn: { lte: today } } : {}),
      ...(q ? { OR: [{ clientName: { contains: q, mode: "insensitive" as const } }, { wants: { contains: q, mode: "insensitive" as const } }, { foundCodes: { has: q } }] } : {}),
    },
    orderBy: f.tab === "encerrados" ? { closedAt: "desc" } : [{ followUpOn: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: { id: true, clientName: true, wants: true, status: true, followUpOn: true, sentToCaptureAt: true, foundCodes: true, createdAt: true, lastUpdateAt: true, closedAt: true, closeReason: true, maxBudgetCents: true, areas: true, propertyType: true, bedrooms: true, createdBy: { select: { name: true } } },
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
export async function updateRadar(actor: AuthzActor, id: string, input: { note: string; followUpDays?: string | number; foundCodes?: string; sentToCapture?: boolean }, now = new Date()) {
  assert(canUseRadar(actor));
  const note = input.note.trim().slice(0, 1500);
  if (note.length < 3) throw new AppError("VALIDATION", "Conte o que aconteceu.", { note: "Obrigatório." });
  const codes = codesOf(input.foundCodes ?? "");
  if (codes.some((c) => !/^[\w-]{2,40}$/.test(c))) throw new AppError("VALIDATION", "Confira os códigos dos imóveis.", { foundCodes: "Código inválido (vários: separe com ;)." });
  return db.$transaction(async (tx) => {
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
        ...(codes.length ? { foundCodes: found, status: "FOUND" as const } : {}),
        ...(markSent ? { sentToCaptureAt: now } : {}),
      },
    });
    const extra = [markSent ? "Passado à captação." : "", codes.length ? `Captação achou: ${codes.join(", ")}.` : ""].filter(Boolean).join(" ");
    await tx.radarEvent.create({ data: { radarId: id, note: [extra, note].filter(Boolean).join(" — ").slice(0, 2000), authorId: actor.id, createdAt: now } });
    await audit(tx, { actorId: actor.id, action: "radar.updated", entityType: "ClientRadar", entityId: id, changes: codes.length ? { imoveis: codes } : undefined });
  });
}

export async function closeRadar(actor: AuthzActor, id: string, input: { reason: string; note?: string }, now = new Date()) {
  assert(canUseRadar(actor));
  if (!(RADAR_CLOSE_REASONS as readonly string[]).includes(input.reason)) throw new AppError("VALIDATION", "Escolha como terminou.", { reason: "Obrigatório." });
  const note = (input.note ?? "").trim().slice(0, 1000) || null;
  return db.$transaction(async (tx) => {
    const r = await tx.clientRadar.findUnique({ where: { id } });
    if (!r) throw notFound();
    if (r.status === "CLOSED") throw new AppError("INVALID_STATE", "Este pedido já está encerrado.");
    await tx.clientRadar.update({ where: { id }, data: { status: "CLOSED", closedAt: now, closedById: actor.id, closeReason: input.reason, closeNote: note, lastUpdateAt: now } });
    await tx.radarEvent.create({ data: { radarId: id, note: `Encerrado: ${input.reason}${note ? ` — ${note}` : ""}`, authorId: actor.id, createdAt: now } });
    await audit(tx, { actorId: actor.id, action: "radar.closed", entityType: "ClientRadar", entityId: id, changes: { resultado: input.reason } });
  });
}

export async function reopenRadar(actor: AuthzActor, id: string, now = new Date()) {
  assert(canUseRadar(actor));
  return db.$transaction(async (tx) => {
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
  });
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
