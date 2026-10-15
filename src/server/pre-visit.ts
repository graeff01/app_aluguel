/**
 * Pré-análise aprovada → visita em um toque: nome, telefone e imóvel de interesse já preenchidos;
 * a consultora escolhe dia e horário e coloca na agenda com o evento preenchido (mesmo fluxo do reagendamento).
 * A visita fica ligada à pré-análise (funil pré-análise → visita → locação).
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { decryptSecret } from "@/lib/crypto";
import { assert, canResolvePreAnalysis, type AuthzActor } from "@/lib/authz";
import { fromLocalInput } from "@/lib/time";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { resolveClient } from "./clients";
import { ensureProperty } from "./visits";
import { assertNoOverlap, newLinkCode } from "./reschedule";

export async function scheduleFromPreAnalysis(
  actor: AuthzActor,
  preId: string,
  input: { requestId: string; scheduledStart: string; durationMinutes: number; propertyCode: string; allowOverlap?: boolean },
  now = new Date(),
) {
  const p = await db.preAnalysis.findUnique({ where: { id: preId } });
  if (!p) throw notFound();
  assert(canResolvePreAnalysis(actor, p));
  if (p.status !== "APPROVED") throw new AppError("INVALID_STATE", "Só dá para agendar a partir de uma pré-análise aprovada.");
  if (p.purgedAt) throw new AppError("INVALID_STATE", "Os dados desta pré-análise já foram apagados (LGPD). Cadastre a visita pela agenda.");
  const requestId = `pre-${input.requestId}`.slice(0, 100);
  const dup = await db.visit.findUnique({ where: { createRequestId: requestId } });
  if (dup) return dup;
  const start = fromLocalInput(input.scheduledStart);
  if (!start) throw new AppError("VALIDATION", "Informe data e horário.", { scheduledStart: "Data inválida." });
  if (start.getTime() < now.getTime() - 5 * 60_000) throw new AppError("VALIDATION", "Escolha um horário a partir de agora.", { scheduledStart: "Horário já passou." });
  const code = input.propertyCode.replace(/\s+/g, "").slice(0, 40);
  if (!/^[0-9A-Za-z-]{2,40}$/.test(code)) throw new AppError("VALIDATION", "Informe o código do imóvel.", { propertyCode: "Obrigatório." });
  const minutes = Math.min(600, Math.max(15, Math.round(input.durationMinutes || 60)));
  const end = new Date(start.getTime() + minutes * 60_000);
  if (!input.allowOverlap) await assertNoOverlap(p.consultantId, start, end);
  // telefone e nome são opcionais na pré-análise
  const phoneE164 = p.phoneEnc ? decryptSecret(p.phoneEnc) : null;
  const phone = normalizePhone(phoneE164);
  const phoneRaw = phoneE164 ? formatPhone(phone.normalized, phoneE164) : null;
  const clientName = p.fullName.trim() || null;

  return db.$transaction(async (tx) => {
    const link = await resolveClient(tx, { clientName, phoneRaw });
    const v = await tx.visit.create({
      data: {
        origin: "MANUAL",
        createRequestId: requestId,
        scheduledStart: start,
        scheduledEnd: end,
        clientName,
        phoneRaw,
        phoneNormalized: phone.normalized,
        propertyCode: code,
        propertyId: await ensureProperty(tx, code),
        consultantId: p.consultantId,
        assignmentStatus: "MANUAL",
        assignmentNote: "PRE_ANALISE",
        scheduledById: actor.role === "CONSULTANT" ? actor.id : p.consultantId,
        linkCode: newLinkCode(),
        preAnalysisId: p.id,
        ...link,
      },
    });
    await audit(tx, { actorId: actor.id, action: "visit.from_preanalysis", entityType: "Visit", entityId: v.id, changes: { preAnalise: p.id } });
    return v;
  });
}
