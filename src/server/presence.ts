/** Confirmação de presença do cliente (registrada pela consultora depois de falar com ele). */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, canConcludeVisit, type AuthzActor } from "@/lib/authz";

export async function setPresence(actor: AuthzActor, visitId: string, status: "CONFIRMED" | "NO_REPLY" | null) {
  const v = await db.visit.findUnique({ where: { id: visitId } });
  if (!v) throw notFound();
  assert(canConcludeVisit(actor, v));
  if (v.status !== "SCHEDULED") throw new AppError("INVALID_STATE", "A visita já tem resultado.");
  if (status !== null && status !== "CONFIRMED" && status !== "NO_REPLY") throw new AppError("VALIDATION", "Opção inválida.");
  await db.$transaction(async (tx) => {
    await tx.visit.update({ where: { id: visitId }, data: { confirmStatus: status, confirmedAt: status ? new Date() : null } });
    await audit(tx, { actorId: actor.id, action: "visit.presence", entityType: "Visit", entityId: visitId, changes: { status } });
  });
}
