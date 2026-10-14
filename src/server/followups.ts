/**
 * Retornos do "ainda decidindo": no dia combinado, a visita aparece para a consultora ligar de volta.
 * Some sozinho se o cliente já tiver outra visita marcada depois, ou se a oportunidade já foi fechada/perdida.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, canConcludeVisit, type AuthzActor } from "@/lib/authz";
import { addDays, dateOnlyFromKey, dayKey } from "@/lib/time";

export async function dueFollowUps(consultantId: string, now = new Date()) {
  const today = dateOnlyFromKey(dayKey(now));
  const rows = await db.visit.findMany({
    where: { consultantId, status: "DONE", evaluation: "UNDECIDED", excluded: false, followUpOn: { lte: today }, followUpDoneAt: null },
    orderBy: { followUpOn: "asc" },
    select: {
      id: true,
      clientId: true,
      clientName: true,
      phoneNormalized: true,
      propertyCode: true,
      scheduledStart: true,
      followUpOn: true,
      note: true,
      opportunity: { select: { status: true } },
      property: { select: { photoUrl: true, neighborhood: true } },
    },
  });
  const out: typeof rows = [];
  for (const r of rows) {
    if (r.opportunity && (r.opportunity.status === "CLOSED_WON" || r.opportunity.status === "LOST")) continue;
    if (r.clientId && (await db.visit.count({ where: { clientId: r.clientId, scheduledStart: { gt: r.scheduledStart }, status: { in: ["SCHEDULED", "DONE"] } } }))) continue;
    out.push(r);
  }
  return out;
}

export async function followUpAction(actor: AuthzActor, visitId: string, action: "done" | "snooze") {
  const v = await db.visit.findUnique({ where: { id: visitId } });
  if (!v) throw notFound();
  assert(canConcludeVisit(actor, v));
  if (!v.followUpOn) throw new AppError("INVALID_STATE", "Esta visita não tem retorno marcado.");
  await db.$transaction(async (tx) => {
    await tx.visit.update({
      where: { id: visitId },
      data: action === "done" ? { followUpDoneAt: new Date() } : { followUpOn: dateOnlyFromKey(addDays(dayKey(new Date()), 2)) },
    });
    await audit(tx, { actorId: actor.id, action: action === "done" ? "visit.followup_done" : "visit.followup_snoozed", entityType: "Visit", entityId: visitId });
  });
}
