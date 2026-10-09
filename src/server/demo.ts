/**
 * Dados FICTÍCIOS de demonstração (scripts/demo-data.ts): clientes com prefixo "[DEMO]".
 * Remoção pelo admin (Diagnóstico) sem acesso direto ao banco.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assert, isAdmin, type AuthzActor } from "@/lib/authz";

export const DEMO_PREFIX = "[DEMO]";
const demoWhere = { clientName: { startsWith: DEMO_PREFIX } };

export function countDemoVisits() {
  return db.visit.count({ where: demoWhere });
}

/** Remove visitas de demonstração com histórico, oportunidades e clientes que ficarem sem visitas. */
export async function removeDemoData(actor: AuthzActor | null, consultantId?: string) {
  if (actor) assert(isAdmin(actor));
  const visits = await db.visit.findMany({ where: { ...demoWhere, ...(consultantId ? { consultantId } : {}) }, select: { id: true, clientId: true, opportunityId: true } });
  const ids = visits.map((v) => v.id);
  const opps = [...new Set(visits.map((v) => v.opportunityId).filter(Boolean))] as string[];
  const clients = [...new Set(visits.map((v) => v.clientId).filter(Boolean))] as string[];
  await db.$transaction(async (tx) => {
    await tx.visit.updateMany({ where: { id: { in: ids } }, data: { opportunityId: null } });
    await tx.opportunity.deleteMany({ where: { id: { in: opps }, visits: { none: {} } } });
    await tx.visitOutcomeHistory.deleteMany({ where: { visitId: { in: ids } } });
    await tx.visit.deleteMany({ where: { id: { in: ids } } });
    await tx.client.deleteMany({ where: { id: { in: clients }, visits: { none: {} }, opportunities: { none: {} } } });
    await tx.auditLog.deleteMany({ where: { entityType: "Visit", entityId: { in: ids } } });
    if (ids.length) await audit(tx, { actorId: actor?.id ?? null, action: "demo.removed", entityType: "Visit", entityId: "-", changes: { visitas: ids.length } });
  });
  return ids.length;
}
