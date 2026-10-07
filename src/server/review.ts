/** Revisão de eventos ambíguos (gestão). */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assert, canReview, type AuthzActor } from "@/lib/authz";
import { notFound } from "@/lib/errors";
import { assignConsultant, parseVisitEvent } from "@/lib/parser";
import { normalizeEmail } from "@/lib/text";
import { resolveClient } from "./clients";
import { ensureProperty } from "./visits";
import { Prisma } from "@/generated/prisma/client";

export async function acceptAmbiguous(actor: AuthzActor, sourceEventId: string) {
  assert(canReview(actor));
  const aliases = new Map(
    (await db.userEmailAlias.findMany({ where: { user: { role: "CONSULTANT", active: true } } })).map((a) => [normalizeEmail(a.email), a.userId]),
  );
  return db.$transaction(async (tx) => {
    const ev = await tx.sourceEvent.findUnique({ where: { id: sourceEventId }, include: { visit: true } });
    if (!ev || ev.classification !== "AMBIGUOUS") throw notFound();
    const parsed = parseVisitEvent(ev.title ?? "", ev.description, "");
    await tx.sourceEvent.update({
      where: { id: ev.id },
      data: { reviewDecision: "ACCEPTED_AS_VISIT", reviewedById: actor.id, reviewedAt: new Date(), parsed: parsed as unknown as Prisma.InputJsonValue },
    });
    if (!ev.visit && ev.startAt && ev.endAt) {
      const attendees = (ev.attendees ?? []) as { email: string | null; organizer: boolean; resource: boolean }[];
      const assignment = assignConsultant(attendees, ev.attendeesOmitted, aliases);
      const link = await resolveClient(tx, { clientName: parsed.clientName, phoneRaw: parsed.phoneRaw });
      await tx.visit.create({
        data: {
          origin: "GOOGLE",
          sourceEventId: ev.id,
          scheduledStart: ev.startAt,
          scheduledEnd: ev.endAt,
          clientName: parsed.clientName,
          phoneRaw: parsed.phoneRaw,
          phoneNormalized: parsed.phoneNormalized,
          propertyCode: parsed.propertyCode,
          propertyId: await ensureProperty(tx, parsed.propertyCode),
          externalRef: parsed.externalRef,
          consultantId: assignment.consultantId,
          assignmentStatus: assignment.status,
          assignmentNote: assignment.note,
          ...link,
        },
      });
    }
    await audit(tx, { actorId: actor.id, action: "event.accepted_as_visit", entityType: "SourceEvent", entityId: ev.id });
  });
}

export async function rejectAmbiguous(actor: AuthzActor, sourceEventId: string) {
  assert(canReview(actor));
  return db.$transaction(async (tx) => {
    const ev = await tx.sourceEvent.findUnique({ where: { id: sourceEventId } });
    if (!ev || ev.classification !== "AMBIGUOUS") throw notFound();
    // não é visita: remove o conteúdo do espelho (minimização), mantém só identificadores
    await tx.sourceEvent.update({
      where: { id: ev.id },
      data: { reviewDecision: "REJECTED", reviewedById: actor.id, reviewedAt: new Date(), title: null, description: null, attendees: Prisma.DbNull, parsed: Prisma.DbNull, organizerEmail: null },
    });
    await audit(tx, { actorId: actor.id, action: "event.rejected", entityType: "SourceEvent", entityId: ev.id });
  });
}
