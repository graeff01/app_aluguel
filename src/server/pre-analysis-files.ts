/**
 * Documentos do cliente na pré-análise (RG, CNH, comprovante de renda…).
 * Ficam CRIPTOGRAFADOS no banco e são vistos só por quem vê a pré-análise (pré-atendimento, gestão e a consultora
 * escolhida). Apagados junto com os demais dados pessoais na retenção (LGPD).
 */
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { decryptBytes, encryptBytes } from "@/lib/crypto";
import { assert, canViewPreAnalysis, hasGlobalView, type AuthzActor } from "@/lib/authz";

export const MAX_FILES = 12;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

/** Tipo pelo conteúdo (não confia no nome nem no tipo informado pelo navegador). */
function sniff(b: Buffer): { mime: string; ext: string } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp" && /^(heic|heix|mif1|msf1|heim|heis)$/.test(b.toString("latin1", 8, 12))) return { mime: "image/heic", ext: "heic" };
  if (b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}

function cleanName(name: string, ext: string) {
  const base = name.replace(/\.[^.]{1,5}$/, "").replace(/[^\p{L}\p{N} ._-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "documento";
  return `${base}.${ext}`;
}

export type IncomingFile = { name: string; type?: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

/** Lê e valida os arquivos enviados (vazios são ignorados: input sem arquivo manda um item vazio). */
export async function readFiles(files: IncomingFile[], alreadyStored = 0) {
  const list = files.filter((f) => f && f.size > 0);
  if (list.length + alreadyStored > MAX_FILES) throw new AppError("VALIDATION", `Até ${MAX_FILES} documentos por pré-análise.`, { files: "Documentos demais." });
  const out: { name: string; mime: string; size: number; data: Buffer }[] = [];
  let total = 0;
  for (const f of list) {
    if (f.size > MAX_FILE_BYTES) throw new AppError("VALIDATION", `“${f.name}” passa de 8 MB. Tire a foto de novo ou envie em PDF menor.`, { files: "Arquivo grande demais." });
    const buf = Buffer.from(await f.arrayBuffer());
    const kind = sniff(buf);
    if (!kind) throw new AppError("VALIDATION", `“${f.name}” não é foto nem PDF. Envie imagem (JPG, PNG) ou PDF.`, { files: "Tipo de arquivo não aceito." });
    total += buf.length;
    out.push({ name: cleanName(f.name, kind.ext), mime: kind.mime, size: buf.length, data: buf });
  }
  if (total > MAX_TOTAL_BYTES) throw new AppError("VALIDATION", "Os documentos passam de 24 MB no total. Envie em partes.", { files: "Total grande demais." });
  return out;
}

export async function saveFiles(tx: Tx, preAnalysisId: string, actorId: string, files: Awaited<ReturnType<typeof readFiles>>) {
  for (const f of files) {
    await tx.preAnalysisFile.create({ data: { preAnalysisId, name: f.name, mime: f.mime, size: f.size, data: new Uint8Array(encryptBytes(f.data)), uploadedById: actorId } });
  }
  if (files.length) await audit(tx, { actorId, action: "preanalysis.files_added", entityType: "PreAnalysis", entityId: preAnalysisId, changes: { quantidade: files.length } });
}

/** Mais documentos depois do envio (ex.: pré-análise pendente esperando comprovante). */
export async function addPreAnalysisFiles(actor: AuthzActor, preAnalysisId: string, files: IncomingFile[]) {
  const p = await db.preAnalysis.findUnique({ where: { id: preAnalysisId }, include: { _count: { select: { files: true } } } });
  if (!p) throw notFound();
  assert(canViewPreAnalysis(actor, p));
  if (p.purgedAt) throw new AppError("INVALID_STATE", "Os dados desta pré-análise já foram apagados (prazo de retenção).");
  const read = await readFiles(files, p._count.files);
  if (!read.length) throw new AppError("VALIDATION", "Escolha ao menos um documento.", { files: "Nenhum arquivo." });
  // pendente e quem anexou não é a consultora: os documentos que faltavam chegaram → volta para ela analisar
  const resubmit = p.status === "PENDING" && actor.id !== p.consultantId;
  await db.$transaction(async (tx) => {
    await saveFiles(tx, p.id, actor.id, read);
    if (resubmit) {
      await tx.preAnalysis.update({ where: { id: p.id }, data: { status: "AWAITING" } });
      await audit(tx, { actorId: actor.id, action: "preanalysis.resubmitted", entityType: "PreAnalysis", entityId: p.id, changes: { faltava: p.missingItems } });
    }
  });
  return { count: read.length, consultantId: p.consultantId, createdById: p.createdById, resubmitted: resubmit };
}

export async function listPreAnalysisFiles(actor: AuthzActor, preAnalysisId: string) {
  return db.preAnalysisFile.findMany({
    where: { preAnalysisId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, mime: true, size: true, createdAt: true, uploadedById: true, uploadedBy: { select: { name: true } } },
  });
}

/** Conteúdo decifrado, só para quem vê a pré-análise; cada abertura fica na auditoria. */
export async function readPreAnalysisFile(actor: AuthzActor, preAnalysisId: string, fileId: string) {
  const f = await db.preAnalysisFile.findUnique({ where: { id: fileId }, include: { preAnalysis: { select: { id: true, consultantId: true } } } });
  if (!f || f.preAnalysisId !== preAnalysisId) throw notFound();
  assert(canViewPreAnalysis(actor, f.preAnalysis));
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "preanalysis.file_viewed", entityType: "PreAnalysis", entityId: preAnalysisId, changes: { arquivo: f.id } }));
  return { name: f.name, mime: f.mime, data: decryptBytes(Buffer.from(f.data)) };
}

export async function deletePreAnalysisFile(actor: AuthzActor, fileId: string) {
  const f = await db.preAnalysisFile.findUnique({ where: { id: fileId }, include: { preAnalysis: { select: { consultantId: true } } } });
  if (!f) throw notFound();
  assert(canViewPreAnalysis(actor, f.preAnalysis) && (f.uploadedById === actor.id || hasGlobalView(actor)));
  await db.$transaction(async (tx) => {
    await tx.preAnalysisFile.delete({ where: { id: fileId } });
    await audit(tx, { actorId: actor.id, action: "preanalysis.file_deleted", entityType: "PreAnalysis", entityId: f.preAnalysisId, changes: { arquivo: f.name } });
  });
  return f.preAnalysisId;
}
