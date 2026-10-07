/**
 * Clientes e identidade telefônica.
 * - Mesmo telefone validado + nome compatível → mesmo cliente (sugestão aceita automaticamente).
 * - Telefone compartilhado ou nome incompatível → novo cadastro PENDENTE + candidatos para revisão (sem fusão automática).
 * - Sem telefone válido → cadastro PENDENTE (não conta como pessoa única confirmada).
 * - Nunca une clientes apenas pelo nome.
 */
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";
import { namesCompatible } from "@/lib/text";
import { normalizePhone } from "@/lib/phone";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, canManageClients, type AuthzActor } from "@/lib/authz";
import type { ClientMatch } from "@/generated/prisma/enums";
import { applyDoneVisit, detachVisitFromOpportunity } from "./opportunities";

export type LinkResult = { clientId: string | null; clientMatch: ClientMatch; clientCandidates: string[] };

async function addPhone(tx: Tx, clientId: string, raw: string | null, normalized: string | null) {
  if (!raw) return;
  await tx.clientPhone.upsert({
    where: { clientId_raw: { clientId, raw } },
    update: { normalized, valid: !!normalized },
    create: { clientId, raw, normalized, valid: !!normalized },
  });
}

/** Decide o cliente de uma visita a partir de nome/telefone. Não altera vínculos confirmados manualmente. */
export async function resolveClient(
  tx: Tx,
  input: { clientName: string | null; phoneRaw: string | null; currentClientId?: string | null },
): Promise<LinkResult> {
  const name = input.clientName?.trim();
  if (!name) return { clientId: null, clientMatch: "NO_PHONE", clientCandidates: [] };
  const phone = normalizePhone(input.phoneRaw);

  if (phone.valid && phone.normalized) {
    const phones = await tx.clientPhone.findMany({
      where: { normalized: phone.normalized, client: { mergedIntoId: null } },
      include: { client: true },
    });
    const clients = [...new Map(phones.map((p) => [p.clientId, p.client])).values()];
    if (clients.length === 0) {
      // reaproveita cadastro atual se for exclusivo desta visita
      const reuse = input.currentClientId ? await reusableClient(tx, input.currentClientId) : null;
      const client = reuse
        ? await tx.client.update({ where: { id: reuse }, data: { name, identityStatus: "CONFIRMED" } })
        : await tx.client.create({ data: { name, identityStatus: "CONFIRMED" } });
      await addPhone(tx, client.id, phone.raw, phone.normalized);
      return { clientId: client.id, clientMatch: "NEW_CONFIRMED", clientCandidates: [] };
    }
    if (clients.length === 1 && namesCompatible(clients[0].name, name)) {
      await addPhone(tx, clients[0].id, phone.raw, phone.normalized);
      return { clientId: clients[0].id, clientMatch: "PHONE_MATCH", clientCandidates: [] };
    }
    // ambíguo: cadastro pendente separado, candidatos para a gestora decidir
    const client = await tx.client.create({ data: { name, identityStatus: "PENDING" } });
    await addPhone(tx, client.id, phone.raw, phone.normalized);
    return { clientId: client.id, clientMatch: "SUGGESTED", clientCandidates: clients.map((c) => c.id) };
  }

  const reuse = input.currentClientId ? await reusableClient(tx, input.currentClientId) : null;
  const client = reuse
    ? await tx.client.update({ where: { id: reuse }, data: { name, identityStatus: "PENDING" } })
    : await tx.client.create({ data: { name, identityStatus: "PENDING" } });
  await addPhone(tx, client.id, phone.raw || null, null);
  return { clientId: client.id, clientMatch: "NO_PHONE", clientCandidates: [] };
}

/** Um cadastro pendente com uma única visita e sem oportunidades pode ser reaproveitado. */
async function reusableClient(tx: Tx, clientId: string): Promise<string | null> {
  const c = await tx.client.findUnique({
    where: { id: clientId },
    include: { _count: { select: { visits: true, opportunities: true } } },
  });
  if (!c || c.mergedIntoId || c.identityStatus === "CONFIRMED") return null;
  if (c._count.visits <= 1 && c._count.opportunities === 0) {
    await tx.clientPhone.deleteMany({ where: { clientId } });
    return clientId;
  }
  return null;
}

/** Remove cadastro órfão criado automaticamente. */
export async function cleanupOrphanClient(tx: Tx, clientId: string | null | undefined) {
  if (!clientId) return;
  const c = await tx.client.findUnique({
    where: { id: clientId },
    include: { _count: { select: { visits: true, opportunities: true } } },
  });
  if (c && c._count.visits === 0 && c._count.opportunities === 0 && !c.mergedIntoId) {
    await tx.client.delete({ where: { id: clientId } });
  }
}

/** Gestão: vincula a visita a um cliente existente (confirmação humana). */
export async function linkVisitToClient(actor: AuthzActor, visitId: string, clientId: string) {
  assert(canManageClients(actor));
  return db.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({ where: { id: visitId } });
    if (!visit) throw notFound();
    const target = await tx.client.findUnique({ where: { id: clientId } });
    if (!target || target.mergedIntoId) throw new AppError("VALIDATION", "Cliente de destino inválido.");
    const previous = visit.clientId;
    await detachVisitFromOpportunity(tx, visit.id, actor.id);
    await tx.visit.update({
      where: { id: visitId },
      data: { clientId, clientMatch: "CONFIRMED_MANUAL", clientCandidates: [], version: { increment: 1 } },
    });
    if (visit.phoneRaw) await addPhone(tx, clientId, visit.phoneRaw, visit.phoneNormalized);
    await applyDoneVisit(tx, visitId, actor.id);
    await audit(tx, { actorId: actor.id, action: "visit.client_linked", entityType: "Visit", entityId: visitId, changes: { de: previous, para: clientId } });
    if (previous && previous !== clientId) await cleanupOrphanClient(tx, previous);
  });
}

/** Gestão: confirma que o cadastro da visita é uma pessoa distinta. */
export async function confirmVisitClientAsDistinct(actor: AuthzActor, visitId: string) {
  assert(canManageClients(actor));
  return db.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({ where: { id: visitId } });
    if (!visit?.clientId) throw notFound();
    await tx.client.update({ where: { id: visit.clientId }, data: { identityStatus: "CONFIRMED" } });
    await tx.visit.update({ where: { id: visitId }, data: { clientMatch: "CONFIRMED_MANUAL", clientCandidates: [] } });
    await audit(tx, { actorId: actor.id, action: "client.confirmed_distinct", entityType: "Client", entityId: visit.clientId, changes: { visitId } });
  });
}

/**
 * Gestão: une dois cadastros (origem → destino) em uma transação, com auditoria.
 * Oportunidades ativas do mesmo imóvel são agrupadas; ciclos encerrados são renumerados.
 */
export async function mergeClients(actor: AuthzActor, sourceId: string, targetId: string) {
  assert(canManageClients(actor));
  if (sourceId === targetId) throw new AppError("VALIDATION", "Escolha cadastros diferentes.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id IN (${sourceId}, ${targetId}) FOR UPDATE`;
    const [source, target] = await Promise.all([
      tx.client.findUnique({ where: { id: sourceId }, include: { phones: true } }),
      tx.client.findUnique({ where: { id: targetId } }),
    ]);
    if (!source || !target || source.mergedIntoId || target.mergedIntoId) throw notFound();

    for (const p of source.phones) await addPhone(tx, targetId, p.raw, p.normalized);
    await tx.clientPhone.deleteMany({ where: { clientId: sourceId } });

    const sourceOpps = await tx.opportunity.findMany({ where: { clientId: sourceId }, orderBy: { cycle: "asc" } });
    for (const o of sourceOpps) {
      const active = o.status === "FOLLOW_UP" || o.status === "DOCS_REVIEW";
      const targetActive = active
        ? await tx.opportunity.findFirst({
            where: { clientId: targetId, propertyId: o.propertyId, status: { in: ["FOLLOW_UP", "DOCS_REVIEW"] } },
          })
        : null;
      if (targetActive) {
        await tx.visit.updateMany({ where: { opportunityId: o.id }, data: { opportunityId: targetActive.id } });
        await tx.opportunityEvent.updateMany({ where: { opportunityId: o.id }, data: { opportunityId: targetActive.id } });
        await tx.opportunity.update({
          where: { id: targetActive.id },
          data: {
            firstDoneVisitAt: o.firstDoneVisitAt < targetActive.firstDoneVisitAt ? o.firstDoneVisitAt : targetActive.firstDoneVisitAt,
            version: { increment: 1 },
          },
        });
        await tx.opportunityEvent.create({
          data: { opportunityId: targetActive.id, fromStatus: targetActive.status, toStatus: targetActive.status, note: "Oportunidades agrupadas por união de cadastros", authorId: actor.id },
        });
        await tx.opportunity.delete({ where: { id: o.id } });
      } else {
        const max = await tx.opportunity.aggregate({ where: { clientId: targetId, propertyId: o.propertyId }, _max: { cycle: true } });
        await tx.opportunity.update({ where: { id: o.id }, data: { clientId: targetId, cycle: (max._max.cycle ?? 0) + 1 } });
      }
    }

    await tx.visit.updateMany({ where: { clientId: sourceId }, data: { clientId: targetId, clientMatch: "CONFIRMED_MANUAL", clientCandidates: [] } });
    // visitas que tinham a origem como candidata deixam de apontar para ela
    const withCandidate = await tx.visit.findMany({ where: { clientCandidates: { has: sourceId } }, select: { id: true, clientCandidates: true } });
    for (const v of withCandidate) {
      await tx.visit.update({
        where: { id: v.id },
        data: { clientCandidates: [...new Set(v.clientCandidates.map((c) => (c === sourceId ? targetId : c)))] },
      });
    }
    await tx.client.update({ where: { id: sourceId }, data: { mergedIntoId: targetId } });
    const hasValidPhone = await tx.clientPhone.count({ where: { clientId: targetId, valid: true } });
    if (hasValidPhone) await tx.client.update({ where: { id: targetId }, data: { identityStatus: "CONFIRMED" } });
    await audit(tx, { actorId: actor.id, action: "client.merged", entityType: "Client", entityId: targetId, changes: { origem: sourceId } });
  });
}
