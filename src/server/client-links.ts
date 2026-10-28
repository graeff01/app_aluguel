/**
 * Ficha única do cliente: liga a pré-análise ao cadastro do cliente.
 * O telefone da pré-análise fica cifrado; para comparar sem guardar o número em claro usamos uma impressão (HMAC).
 *
 * - na criação da pré-análise: cliente já cadastrado com o mesmo telefone (só um) → ligado;
 * - quando um cliente ganha telefone validado numa visita: pré-análises soltas com o mesmo telefone → ligadas;
 * - quando a pré-análise vira visita: ganha o cliente da visita;
 * - pré-análises antigas: o worker calcula a impressão e liga (backfillPreAnalysisLinks).
 */
import { db, type Tx } from "@/lib/db";
import { decryptSecret, hmacHex } from "@/lib/crypto";
import { normalizePhone } from "@/lib/phone";
import { log } from "@/lib/log";

export function phoneHash(normalizedE164: string) {
  return hmacHex(`phone:${normalizedE164}`);
}

/** Único cadastro (não unido a outro) com este telefone validado; ambíguo ou inexistente → null. */
export async function clientByPhone(tx: Tx | typeof db, normalizedE164: string): Promise<string | null> {
  const rows = await tx.clientPhone.findMany({ where: { normalized: normalizedE164, valid: true, client: { mergedIntoId: null } }, select: { clientId: true } });
  const ids = [...new Set(rows.map((r) => r.clientId))];
  return ids.length === 1 ? ids[0] : null;
}

/** Cliente com telefone validado: pré-análises ainda sem cadastro e com o mesmo telefone passam a apontar para ele. */
export async function linkPreAnalysesToClient(tx: Tx, clientId: string, normalizedE164: string) {
  await tx.preAnalysis.updateMany({ where: { phoneHash: phoneHash(normalizedE164), clientId: null, purgedAt: null }, data: { clientId } });
  await tx.proposal.updateMany({ where: { phoneHash: phoneHash(normalizedE164), clientId: null, purgedAt: null }, data: { clientId } });
  await tx.clientRadar.updateMany({ where: { phoneHash: phoneHash(normalizedE164), clientId: null, purgedAt: null }, data: { clientId } });
}

/** Pré-análises antigas (antes da ficha): calcula a impressão do telefone e liga ao cadastro. Idempotente, em lotes. */
export async function backfillPreAnalysisLinks(batch = 200) {
  const rows = await db.preAnalysis.findMany({
    where: { phoneHash: null, phoneEnc: { not: null }, purgedAt: null },
    select: { id: true, phoneEnc: true, clientId: true },
    take: batch,
  });
  let linked = 0;
  for (const r of rows) {
    let normalized: string | null = null;
    try {
      normalized = normalizePhone(decryptSecret(r.phoneEnc!)).normalized;
    } catch {
      normalized = null;
    }
    // "-" marca como processada (telefone ilegível ou inválido) para não tentar de novo
    const hash = normalized ? phoneHash(normalized) : "-";
    const clientId = r.clientId ?? (normalized ? await clientByPhone(db, normalized) : null);
    if (clientId && !r.clientId) linked++;
    await db.preAnalysis.update({ where: { id: r.id }, data: { phoneHash: hash, clientId } });
  }
  if (linked) log.info("preanalysis.client_linked", { count: linked });
  return { processed: rows.length, linked };
}
