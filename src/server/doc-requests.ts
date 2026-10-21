/**
 * Documentos pelo link do cliente.
 *
 * A equipe (pré-atendimento na pré-análise, consultora depois da visita) gera um link e manda no WhatsApp.
 * O cliente abre no celular, confirma a identidade (3 primeiros dígitos do CPF ou 4 últimos do celular),
 * fotografa/envia cada documento pedido e conclui. A equipe é avisada.
 *
 * Segurança e LGPD:
 * - o token do link tem 256 bits; no banco ficam só o hash (para achar) e o token cifrado (para reenviar);
 * - o link expira (7 dias, renovável), pode ser cancelado e trava após tentativas erradas de verificação;
 * - arquivos validados pelo conteúdo (foto ou PDF), cifrados com AES-256-GCM, vistos só pela equipe responsável;
 * - tudo é apagado no prazo de retenção (o mesmo da pré-análise), e cada leitura fica na auditoria.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { decryptBytes, decryptSecret, encryptBytes, encryptSecret, hmacHex, randomToken, safeEqual, sha256 } from "@/lib/crypto";
import { assert, canViewPreAnalysis, canViewVisit, hasGlobalView, isPreService, type AuthzActor } from "@/lib/authz";
import { normalizePhone } from "@/lib/phone";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { normalizeText } from "@/lib/text";
import { readFiles, type IncomingFile } from "./pre-analysis-files";
import { notifyUser } from "./notify";
import { log } from "@/lib/log";

const DAY = 86400_000;
export const DOC_LINK_DAYS = 7;
export const MAX_FILES_PER_ITEM = 6;
export const MAX_FILES_PER_REQUEST = 30;
export const MAX_BYTES_PER_REQUEST = 80 * 1024 * 1024;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
export const SESSION_COOKIE = "vl_doc";
const SESSION_HOURS = 3;

export type DocItem = { key: string; label: string; hint?: string; required: boolean };

/** Itens comuns na locação. A equipe escolhe quais pedir (e pode escrever outros). */
export const DOC_ITEM_PRESETS: DocItem[] = [
  { key: "doc_foto", label: "Documento com foto (RG ou CNH)", hint: "Frente e verso, sem cortar as bordas. A CNH digital em PDF também vale.", required: true },
  { key: "renda", label: "Comprovante de renda", hint: "Últimos 3 contracheques, extrato do INSS ou declaração de IR. Autônomo: 3 últimos extratos bancários.", required: true },
  { key: "residencia", label: "Comprovante de residência", hint: "Conta de luz, água, gás ou internet dos últimos 3 meses.", required: true },
  { key: "extrato", label: "Extrato bancário", hint: "Últimos 3 meses. Pode ser o PDF do aplicativo do banco.", required: false },
  { key: "ir", label: "Declaração de imposto de renda", hint: "Declaração completa com o recibo de entrega.", required: false },
  { key: "estado_civil", label: "Certidão de casamento ou união estável", hint: "Só se for casado(a) ou viver em união estável.", required: false },
  { key: "fiador_doc", label: "Documento com foto do fiador", hint: "RG ou CNH do fiador, frente e verso.", required: true },
  { key: "fiador_renda", label: "Comprovante de renda do fiador", hint: "Últimos 3 contracheques ou declaração de IR do fiador.", required: true },
  { key: "fiador_matricula", label: "Matrícula do imóvel do fiador", hint: "Certidão de matrícula atualizada (emitida há até 30 dias).", required: true },
];
const BASE_KEYS = ["doc_foto", "renda", "residencia"];
const FIADOR_KEYS = ["fiador_doc", "fiador_renda", "fiador_matricula"];

/** Itens sugeridos pela garantia (fiador pede também os documentos do fiador). */
export function suggestedItemKeys(guaranteeLabel: string | null | undefined): string[] {
  return /fiador/.test(normalizeText(guaranteeLabel)) ? [...BASE_KEYS, ...FIADOR_KEYS] : BASE_KEYS;
}

const itemsSchema = z
  .array(z.object({ key: z.string().min(1).max(40), label: z.string().trim().min(2).max(80), hint: z.string().trim().max(200).optional(), required: z.boolean() }))
  .min(1, "Escolha ao menos um documento.")
  .max(15, "Até 15 documentos por pedido.");

/** Monta a lista a partir das chaves marcadas + itens escritos pela equipe ("Outro: holerite do cônjuge"). */
export function buildItems(keys: string[], custom: string[]): DocItem[] {
  const items: DocItem[] = DOC_ITEM_PRESETS.filter((p) => keys.includes(p.key));
  for (const c of custom.map((x) => x.trim()).filter(Boolean)) {
    const key = `outro_${sha256(c).slice(0, 8)}`;
    if (!items.some((i) => i.key === key)) items.push({ key, label: c.slice(0, 80), required: true });
  }
  return items;
}

const dec = (v: string | null | undefined) => {
  if (!v) return null;
  try {
    return decryptSecret(v);
  } catch {
    return null;
  }
};
const firstName = (n: string) => n.trim().split(/\s+/)[0] || "cliente";
const verifyDigits = (kind: string, value: string) => (kind === "CPF" ? value.replace(/\D/g, "").slice(0, 3) : value.replace(/\D/g, "").slice(-4));
const verifyHashOf = (tokenHash: string, digits: string) => hmacHex(`doc-verify:${tokenHash}:${digits}`);

export function docLinkUrl(token: string) {
  return `${env.appUrl}/d/${token}`;
}

/** Quem cuida do pedido: gestão, pré-atendimento, quem criou e a consultora responsável. */
export function canManageDocRequest(a: AuthzActor, r: { createdById: string; consultantId: string | null }) {
  return hasGlobalView(a) || isPreService(a) || r.createdById === a.id || r.consultantId === a.id;
}

// ─────────────── Equipe ───────────────

export async function createDocRequest(
  actor: AuthzActor,
  input: { preAnalysisId?: string; visitId?: string; itemKeys: string[]; custom?: string[]; message?: string; phone?: string },
  now = new Date(),
) {
  const items = itemsSchema.safeParse(buildItems(input.itemKeys, input.custom ?? []));
  if (!items.success) throw new AppError("VALIDATION", items.error.issues[0].message, { items: items.error.issues[0].message });

  let ctx: { preAnalysisId: string | null; opportunityId: string | null; visitId: string | null; consultantId: string | null; clientName: string; phone: string | null; cpf: string | null; propertyCode: string | null };
  if (input.preAnalysisId) {
    const p = await db.preAnalysis.findUnique({ where: { id: input.preAnalysisId } });
    if (!p) throw notFound();
    assert(canViewPreAnalysis(actor, p));
    if (p.purgedAt) throw new AppError("INVALID_STATE", "Os dados desta pré-análise já foram apagados (prazo da LGPD).");
    ctx = { preAnalysisId: p.id, opportunityId: null, visitId: null, consultantId: p.consultantId, clientName: p.fullName, phone: dec(p.phoneEnc), cpf: dec(p.cpfEnc), propertyCode: p.propertyCode };
  } else if (input.visitId) {
    const v = await db.visit.findUnique({ where: { id: input.visitId }, include: { preAnalysis: true } });
    if (!v) throw notFound();
    assert(canViewVisit(actor, v) || isPreService(actor));
    const pa = v.preAnalysis && !v.preAnalysis.purgedAt ? v.preAnalysis : null;
    ctx = {
      preAnalysisId: pa?.id ?? null,
      opportunityId: v.opportunityId,
      visitId: v.id,
      consultantId: v.consultantId,
      clientName: v.clientName ?? pa?.fullName ?? "Cliente",
      phone: v.phoneNormalized ?? dec(pa?.phoneEnc),
      cpf: dec(pa?.cpfEnc),
      propertyCode: v.propertyCode,
    };
  } else throw new AppError("VALIDATION", "Pedido sem pré-análise nem visita.");

  const typed = input.phone?.trim() ? normalizePhone(input.phone).normalized : null;
  if (input.phone?.trim() && !typed) throw new AppError("VALIDATION", "Celular inválido. Confira o DDD e o número.", { phone: "Celular inválido." });
  const phone = typed ?? ctx.phone;
  if (!phone) throw new AppError("VALIDATION", "Informe o celular do cliente: o link vai pelo WhatsApp e ele confirma pelo número.", { phone: "Informe o celular." });
  const verifyKind = ctx.cpf && ctx.cpf.replace(/\D/g, "").length === 11 ? "CPF" : "PHONE";
  const verifyValue = verifyKind === "CPF" ? ctx.cpf! : phone;
  const message = input.message?.trim().slice(0, 500) || null;
  const expiresAt = new Date(now.getTime() + DOC_LINK_DAYS * DAY);

  // mesma pasta do cliente: pedido aberto/enviado da mesma pré-análise ou visita recebe os itens novos
  const linkedTo: Prisma.DocRequestWhereInput[] = [];
  if (ctx.preAnalysisId) linkedTo.push({ preAnalysisId: ctx.preAnalysisId });
  if (ctx.visitId) linkedTo.push({ visitId: ctx.visitId });
  if (ctx.opportunityId) linkedTo.push({ opportunityId: ctx.opportunityId });
  const existing = await db.docRequest.findFirst({ where: { purgedAt: null, status: { in: ["OPEN", "SUBMITTED"] }, OR: linkedTo }, orderBy: { createdAt: "desc" } });

  if (existing) {
    const current = existing.items as DocItem[];
    const merged = [...current, ...items.data.filter((i) => !current.some((c) => c.key === i.key))];
    const added = merged.length - current.length;
    const token = dec(existing.tokenEnc);
    if (!token) throw new AppError("INVALID_STATE", "Não foi possível reabrir o link. Cancele e gere um novo.");
    await db.$transaction(async (tx) => {
      await tx.docRequest.update({
        where: { id: existing.id },
        data: {
          items: merged as Prisma.InputJsonValue,
          status: added > 0 ? "OPEN" : existing.status,
          submittedAt: added > 0 ? null : existing.submittedAt,
          expiresAt: expiresAt > existing.expiresAt ? expiresAt : existing.expiresAt,
          message: message ?? existing.message,
          phoneEnc: encryptSecret(phone),
          visitId: existing.visitId ?? ctx.visitId,
          opportunityId: existing.opportunityId ?? ctx.opportunityId,
          preAnalysisId: existing.preAnalysisId ?? ctx.preAnalysisId,
          lockedUntil: null,
          failedAttempts: 0,
        },
      });
      await audit(tx, { actorId: actor.id, action: "docrequest.items_added", entityType: "DocRequest", entityId: existing.id, changes: { novos: added } });
    });
    return { id: existing.id, url: docLinkUrl(token), phone, clientName: existing.clientName, reused: true, added };
  }

  const token = randomToken(32);
  const tokenHash = sha256(token);
  const r = await db.$transaction(async (tx) => {
    const created = await tx.docRequest.create({
      data: {
        tokenHash,
        tokenEnc: encryptSecret(token),
        preAnalysisId: ctx.preAnalysisId,
        opportunityId: ctx.opportunityId,
        visitId: ctx.visitId,
        consultantId: ctx.consultantId,
        createdById: actor.id,
        clientName: ctx.clientName.slice(0, 200),
        phoneEnc: encryptSecret(phone),
        verifyKind,
        verifyHash: verifyHashOf(tokenHash, verifyDigits(verifyKind, verifyValue)),
        items: items.data as Prisma.InputJsonValue,
        message,
        propertyCode: ctx.propertyCode,
        expiresAt,
      },
    });
    await audit(tx, { actorId: actor.id, action: "docrequest.created", entityType: "DocRequest", entityId: created.id, changes: { itens: items.data.length, verificacao: verifyKind } });
    return created;
  });
  return { id: r.id, url: docLinkUrl(token), phone, clientName: r.clientName, reused: false, added: items.data.length };
}

/** Pedidos de uma pré-análise, visita ou oportunidade (com os arquivos, sem o conteúdo). */
export async function listDocRequests(actor: AuthzActor, where: { preAnalysisId?: string; visitId?: string; opportunityId?: string }, now = new Date()) {
  const or: Prisma.DocRequestWhereInput[] = [];
  if (where.preAnalysisId) or.push({ preAnalysisId: where.preAnalysisId });
  if (where.visitId) or.push({ visitId: where.visitId });
  if (where.opportunityId) or.push({ opportunityId: where.opportunityId });
  if (!or.length) return [];
  const rows = await db.docRequest.findMany({
    where: { OR: or },
    orderBy: { createdAt: "desc" },
    include: { files: { select: { id: true, itemKey: true, name: true, mime: true, size: true, createdAt: true }, orderBy: { createdAt: "asc" } }, createdBy: { select: { name: true } } },
  });
  return rows
    .filter((r) => canManageDocRequest(actor, r))
    .map((r) => {
      const items = r.items as DocItem[];
      const expired = r.status === "OPEN" && r.expiresAt < now;
      return {
        id: r.id,
        status: expired ? ("EXPIRED" as const) : r.status,
        clientName: r.clientName,
        createdAt: r.createdAt,
        createdBy: r.createdBy.name,
        openedAt: r.openedAt,
        verifiedAt: r.verifiedAt,
        submittedAt: r.submittedAt,
        expiresAt: r.expiresAt,
        purgedAt: r.purgedAt,
        lockedUntil: r.lockedUntil && r.lockedUntil > now ? r.lockedUntil : null,
        items: items.map((i) => ({ ...i, files: r.files.filter((f) => f.itemKey === i.key) })),
        done: items.filter((i) => r.files.some((f) => f.itemKey === i.key)).length,
        total: items.length,
      };
    });
}

/** Link e telefone para reenviar no WhatsApp. */
export async function docRequestShare(actor: AuthzActor, id: string) {
  const r = await db.docRequest.findUnique({ where: { id } });
  if (!r || r.purgedAt) throw notFound();
  assert(canManageDocRequest(actor, r));
  const token = dec(r.tokenEnc);
  if (!token) throw notFound();
  return { url: docLinkUrl(token), phone: dec(r.phoneEnc), clientName: r.clientName, status: r.status };
}

/** Renova o prazo (mais 7 dias) e destrava a verificação. */
export async function renewDocRequest(actor: AuthzActor, id: string, now = new Date()) {
  const r = await db.docRequest.findUnique({ where: { id } });
  if (!r || r.purgedAt) throw notFound();
  assert(canManageDocRequest(actor, r));
  if (r.status === "CANCELED") throw new AppError("INVALID_STATE", "Este link foi cancelado. Gere um novo pedido.");
  await db.$transaction(async (tx) => {
    await tx.docRequest.update({ where: { id }, data: { expiresAt: new Date(now.getTime() + DOC_LINK_DAYS * DAY), lockedUntil: null, failedAttempts: 0 } });
    await audit(tx, { actorId: actor.id, action: "docrequest.renewed", entityType: "DocRequest", entityId: id });
  });
}

export async function cancelDocRequest(actor: AuthzActor, id: string, now = new Date()) {
  const r = await db.docRequest.findUnique({ where: { id } });
  if (!r) throw notFound();
  assert(canManageDocRequest(actor, r));
  await db.$transaction(async (tx) => {
    await tx.docRequest.update({ where: { id }, data: { status: "CANCELED", canceledAt: now } });
    await audit(tx, { actorId: actor.id, action: "docrequest.canceled", entityType: "DocRequest", entityId: id });
  });
}

/** Abre um documento enviado pelo cliente (decifrado na hora; registrado na auditoria). */
export async function readClientDocument(actor: AuthzActor, fileId: string) {
  const f = await db.clientDocument.findUnique({ where: { id: fileId }, include: { request: true } });
  if (!f || f.request.purgedAt) throw notFound();
  assert(canManageDocRequest(actor, f.request));
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "docrequest.file_viewed", entityType: "DocRequest", entityId: f.requestId, changes: { arquivo: f.id } }));
  return { name: f.name, mime: f.mime, data: decryptBytes(Buffer.from(f.data)) };
}

// ─────────────── Cliente (link público) ───────────────

async function byToken(token: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  return db.docRequest.findUnique({ where: { tokenHash: sha256(token) } });
}

export type ClientLinkState = "OK" | "INVALID" | "EXPIRED" | "CANCELED";

function linkState(r: Awaited<ReturnType<typeof byToken>>, now: Date): ClientLinkState {
  if (!r || r.purgedAt) return "INVALID";
  if (r.status === "CANCELED") return "CANCELED";
  if (r.status === "OPEN" && r.expiresAt < now) return "EXPIRED";
  return "OK";
}

/** Valor do cookie de sessão do cliente: id.validade.assinatura (dura poucas horas). */
export function sessionValue(requestId: string, now = new Date()) {
  const exp = now.getTime() + SESSION_HOURS * 3600_000;
  return `${requestId}.${exp}.${hmacHex(`doc-session:${requestId}:${exp}`)}`;
}
function sessionOk(cookie: string | undefined, requestId: string, now: Date) {
  if (!cookie) return false;
  const [id, exp, sig] = cookie.split(".");
  if (id !== requestId || !exp || !sig || Number(exp) < now.getTime()) return false;
  return safeEqual(sig, hmacHex(`doc-session:${id}:${exp}`));
}

/** O que a página do cliente mostra (sem dados pessoais além do primeiro nome antes de confirmar). */
export async function clientDocView(token: string, cookie: string | undefined, now = new Date()) {
  const r = await byToken(token);
  const state = linkState(r, now);
  if (state !== "OK" || !r) return { state: (state === "OK" ? "INVALID" : state) as Exclude<ClientLinkState, "OK"> };
  const [consultant, property] = await Promise.all([
    r.consultantId ? db.user.findUnique({ where: { id: r.consultantId }, select: { name: true } }) : null,
    r.propertyCode ? db.property.findUnique({ where: { code: r.propertyCode }, select: { code: true, photoUrl: true, title: true, neighborhood: true, city: true } }) : null,
  ]);
  if (!r.openedAt) await db.docRequest.update({ where: { id: r.id }, data: { openedAt: now } });
  const verified = sessionOk(cookie, r.id, now);
  const base = {
    state: "OK" as const,
    id: r.id,
    firstName: firstName(r.clientName),
    consultant: consultant?.name ?? null,
    property,
    verifyKind: r.verifyKind as "CPF" | "PHONE",
    locked: !!(r.lockedUntil && r.lockedUntil > now),
    expiresAt: r.expiresAt,
  } as const;
  if (!verified) return { ...base, verified: false as const };
  const files = await db.clientDocument.findMany({ where: { requestId: r.id }, select: { id: true, itemKey: true, name: true, mime: true, size: true }, orderBy: { createdAt: "asc" } });
  return {
    ...base,
    verified: true as const,
    status: r.status,
    message: r.message,
    submittedAt: r.submittedAt,
    items: (r.items as DocItem[]).map((i) => ({ ...i, files: files.filter((f) => f.itemKey === i.key) })),
  };
}

/** Confirmação de identidade do cliente. Trava por 15 min depois de 5 erros. */
export async function verifyClient(token: string, digits: string, now = new Date()) {
  const r = await byToken(token);
  if (linkState(r, now) !== "OK" || !r) throw new AppError("NOT_FOUND", "Link inválido ou expirado.");
  if (r.lockedUntil && r.lockedUntil > now) throw new AppError("RATE_LIMITED", `Muitas tentativas. Tente de novo em ${Math.ceil((r.lockedUntil.getTime() - now.getTime()) / 60000)} min ou fale com a sua consultora.`);
  const want = r.verifyKind === "CPF" ? 3 : 4;
  const clean = digits.replace(/\D/g, "");
  if (clean.length !== want) throw new AppError("VALIDATION", `Digite ${want} números.`, { digits: `Digite ${want} números.` });
  if (r.verifyHash && safeEqual(verifyHashOf(r.tokenHash, clean), r.verifyHash)) {
    await db.$transaction(async (tx) => {
      await tx.docRequest.update({ where: { id: r.id }, data: { failedAttempts: 0, lockedUntil: null, verifiedAt: r.verifiedAt ?? now, lastActivityAt: now } });
      await audit(tx, { actorId: null, action: "docrequest.client_verified", entityType: "DocRequest", entityId: r.id });
    });
    return sessionValue(r.id, now);
  }
  const failed = r.failedAttempts + 1;
  const lock = failed >= MAX_FAILED;
  await db.$transaction(async (tx) => {
    await tx.docRequest.update({ where: { id: r.id }, data: { failedAttempts: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null } });
    await audit(tx, { actorId: null, action: lock ? "docrequest.client_locked" : "docrequest.client_verify_failed", entityType: "DocRequest", entityId: r.id });
  });
  if (lock) throw new AppError("RATE_LIMITED", `Muitas tentativas. Por segurança, o link fica bloqueado por ${LOCK_MINUTES} minutos.`);
  throw new AppError("VALIDATION", `Os números não conferem. Restam ${MAX_FAILED - failed} tentativa${MAX_FAILED - failed === 1 ? "" : "s"}.`, { digits: "Não confere." });
}

async function sessionRequest(token: string, cookie: string | undefined, now: Date) {
  const r = await byToken(token);
  if (linkState(r, now) !== "OK" || !r) throw new AppError("NOT_FOUND", "Link inválido ou expirado.");
  if (!sessionOk(cookie, r.id, now)) throw new AppError("FORBIDDEN", "Sua sessão terminou. Recarregue a página e confirme seus dados de novo.");
  if (r.status !== "OPEN") throw new AppError("INVALID_STATE", "Os documentos já foram enviados. Se precisar mandar mais, fale com a sua consultora.");
  return r;
}

export async function uploadClientDocument(token: string, cookie: string | undefined, itemKey: string, file: IncomingFile, now = new Date()) {
  const r = await sessionRequest(token, cookie, now);
  const items = r.items as DocItem[];
  if (!items.some((i) => i.key === itemKey)) throw new AppError("VALIDATION", "Documento não pedido neste link.");
  const stats = await db.clientDocument.groupBy({ by: ["itemKey"], where: { requestId: r.id }, _count: { _all: true }, _sum: { size: true } });
  const totalFiles = stats.reduce((a, s) => a + s._count._all, 0);
  const totalBytes = stats.reduce((a, s) => a + (s._sum.size ?? 0), 0);
  if ((stats.find((s) => s.itemKey === itemKey)?._count._all ?? 0) >= MAX_FILES_PER_ITEM) throw new AppError("VALIDATION", `Até ${MAX_FILES_PER_ITEM} arquivos por documento. Remova algum antes de enviar outro.`);
  if (totalFiles >= MAX_FILES_PER_REQUEST) throw new AppError("VALIDATION", "Limite de arquivos deste link atingido. Fale com a sua consultora.");
  const [f] = await readFiles([file]);
  if (!f) throw new AppError("VALIDATION", "Arquivo vazio.");
  if (totalBytes + f.size > MAX_BYTES_PER_REQUEST) throw new AppError("VALIDATION", "Limite de tamanho deste link atingido. Envie fotos menores ou fale com a sua consultora.");
  const label = items.find((i) => i.key === itemKey)!.label;
  const ext = f.name.split(".").pop();
  const created = await db.$transaction(async (tx) => {
    const n = (stats.find((s) => s.itemKey === itemKey)?._count._all ?? 0) + 1;
    const doc = await tx.clientDocument.create({
      data: { requestId: r.id, itemKey, name: `${label.replace(/[^\p{L}\p{N} ()-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60)}${n > 1 ? ` (${n})` : ""}.${ext}`, mime: f.mime, size: f.size, data: new Uint8Array(encryptBytes(f.data)) },
      select: { id: true, itemKey: true, name: true, mime: true, size: true },
    });
    await tx.docRequest.update({ where: { id: r.id }, data: { lastActivityAt: now } });
    await audit(tx, { actorId: null, action: "docrequest.client_uploaded", entityType: "DocRequest", entityId: r.id, changes: { item: itemKey } });
    return doc;
  });
  return created;
}

export async function removeClientDocument(token: string, cookie: string | undefined, fileId: string, now = new Date()) {
  const r = await sessionRequest(token, cookie, now);
  const f = await db.clientDocument.findUnique({ where: { id: fileId } });
  if (!f || f.requestId !== r.id) throw notFound();
  await db.$transaction(async (tx) => {
    await tx.clientDocument.delete({ where: { id: f.id } });
    await audit(tx, { actorId: null, action: "docrequest.client_removed", entityType: "DocRequest", entityId: r.id, changes: { item: f.itemKey } });
  });
}

/** Cliente conclui: confere os obrigatórios, avisa a equipe e devolve a pré-análise pendente para análise. */
export async function submitClientDocuments(token: string, cookie: string | undefined, now = new Date()) {
  const r = await sessionRequest(token, cookie, now);
  const items = r.items as DocItem[];
  const have = new Set((await db.clientDocument.findMany({ where: { requestId: r.id }, select: { itemKey: true } })).map((f) => f.itemKey));
  const missing = items.filter((i) => i.required && !have.has(i.key));
  if (missing.length) throw new AppError("VALIDATION", `Falta enviar: ${missing.map((m) => m.label).join(", ")}.`);
  const pa = r.preAnalysisId ? await db.preAnalysis.findUnique({ where: { id: r.preAnalysisId }, select: { id: true, status: true, missingItems: true } }) : null;
  await db.$transaction(async (tx) => {
    await tx.docRequest.update({ where: { id: r.id }, data: { status: "SUBMITTED", submittedAt: now, lastActivityAt: now } });
    await audit(tx, { actorId: null, action: "docrequest.client_submitted", entityType: "DocRequest", entityId: r.id, changes: { arquivos: have.size } });
    if (pa?.status === "PENDING") {
      await tx.preAnalysis.update({ where: { id: pa.id }, data: { status: "AWAITING" } });
      await audit(tx, { actorId: null, action: "preanalysis.resubmitted", entityType: "PreAnalysis", entityId: pa.id, changes: { faltava: pa.missingItems, origem: "link do cliente" } });
    }
  });
  const url = r.preAnalysisId ? `/pre-analises/${r.preAnalysisId}` : r.visitId ? `/visitas/${r.visitId}` : "/";
  for (const uid of new Set([r.createdById, r.consultantId].filter((x): x is string => !!x))) {
    // sem dados do cliente na notificação
    await notifyUser(uid, { title: "Documentos recebidos", body: "Um cliente concluiu o envio pelo link. Toque para conferir.", url, tag: `docs-${r.id}` }).catch(() => undefined);
  }
}

// ─────────────── Retenção (LGPD) ───────────────

/** Apaga arquivos e dados pessoais dos pedidos vencidos no prazo (o mesmo da pré-análise). */
export async function runDocRequestRetention(now = new Date()) {
  const settings = await getSettings();
  const limit = new Date(now.getTime() - settings.preAnalysisRetentionDays * DAY);
  const ids = (
    await db.docRequest.findMany({
      where: { purgedAt: null, OR: [{ createdAt: { lt: limit } }, { preAnalysis: { purgedAt: { not: null } } }] },
      select: { id: true },
    })
  ).map((r) => r.id);
  if (!ids.length) return { purged: 0 };
  await db.$transaction(async (tx) => {
    await tx.clientDocument.deleteMany({ where: { requestId: { in: ids } } });
    await tx.docRequest.updateMany({ where: { id: { in: ids } }, data: { tokenEnc: null, phoneEnc: null, verifyHash: null, purgedAt: now, status: "CANCELED" } });
    await audit(tx, { actorId: null, action: "docrequest.purged", entityType: "DocRequest", entityId: "-", changes: { quantidade: ids.length, dias: settings.preAnalysisRetentionDays } });
  });
  log.info("docrequest.purged", { count: ids.length });
  return { purged: ids.length };
}
