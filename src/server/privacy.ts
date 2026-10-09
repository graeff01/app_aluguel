/**
 * LGPD: anonimização de clientes (pedido do titular ou retenção) preservando as métricas.
 * Mantém: datas, situação, avaliação, motivo, imóvel e consultora das visitas (indicadores continuam corretos).
 * Remove: nome, telefones, observações, referência externa e o conteúdo espelhado do evento da agenda.
 */
import { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, canManageClients, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/log";

export const ANON_NAME = "Cliente anonimizado";
export const ANON_NOTE = "[removido por privacidade]";

async function anonymizeTx(tx: Tx, clientId: string, actorId: string | null, reason: string) {
  const client = await tx.client.findUnique({ where: { id: clientId } });
  if (!client) throw notFound();
  if (client.anonymizedAt) return false;
  const visits = await tx.visit.findMany({ where: { clientId }, select: { id: true, note: true, sourceEventId: true, opportunityId: true } });
  const visitIds = visits.map((v) => v.id);
  const sourceIds = visits.map((v) => v.sourceEventId).filter((x): x is string => !!x);
  const oppIds = [...new Set(visits.map((v) => v.opportunityId).filter((x): x is string => !!x))];

  await tx.clientPhone.deleteMany({ where: { clientId } });
  await tx.client.update({ where: { id: clientId }, data: { name: ANON_NAME, identityStatus: "PENDING", anonymizedAt: new Date() } });
  await tx.visit.updateMany({
    where: { id: { in: visitIds } },
    data: { clientName: ANON_NAME, phoneRaw: null, phoneNormalized: null, externalRef: null, clientCandidates: [], conflictDetail: Prisma.DbNull },
  });
  // observação obrigatória nas conclusões: substitui o texto, não apaga
  await tx.visit.updateMany({ where: { id: { in: visitIds }, note: { not: null } }, data: { note: ANON_NOTE } });
  await tx.visitOutcomeHistory.updateMany({ where: { visitId: { in: visitIds }, note: { not: null } }, data: { note: ANON_NOTE } });
  await tx.sourceEvent.updateMany({
    where: { id: { in: sourceIds } },
    data: { title: null, description: null, organizerEmail: null, attendees: Prisma.DbNull, parsed: Prisma.DbNull },
  });
  await tx.opportunity.updateMany({ where: { id: { in: oppIds }, lostNote: { not: null } }, data: { lostNote: ANON_NOTE } });
  await tx.opportunityEvent.updateMany({ where: { opportunityId: { in: oppIds }, note: { not: null } }, data: { note: ANON_NOTE } });
  await audit(tx, { actorId, action: "client.anonymized", entityType: "Client", entityId: clientId, changes: { motivo: reason, visitas: visitIds.length } });
  return true;
}

/** Pedido do titular (ou decisão da gestão): anonimiza na hora. Irreversível. */
export async function anonymizeClient(actor: AuthzActor, clientId: string, reason: string) {
  assert(canManageClients(actor));
  const r = reason.trim();
  if (r.length < 3) throw new AppError("VALIDATION", "Informe o motivo (ex.: pedido do titular).", { reason: "Obrigatório." });
  return db.$transaction((tx) => anonymizeTx(tx, clientId, actor.id, r.slice(0, 200)));
}

/** Retenção automática: clientes sem visita nem movimento de oportunidade há N meses. */
export async function runRetention(now = new Date(), opts: { force?: boolean; batch?: number } = {}) {
  const settings = await getSettings();
  if (!settings.retentionMonths) return { skipped: "DISABLED" as const, anonymized: 0 };
  if (!opts.force && settings.retentionLastRunAt && now.getTime() - settings.retentionLastRunAt.getTime() < 20 * 3600_000) {
    return { skipped: "RECENT" as const, anonymized: 0 };
  }
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - settings.retentionMonths);
  const candidates = await db.client.findMany({
    where: {
      anonymizedAt: null,
      createdAt: { lt: cutoff },
      visits: { none: { scheduledStart: { gte: cutoff } } },
      opportunities: { none: { OR: [{ updatedAt: { gte: cutoff } }, { status: { in: ["FOLLOW_UP", "DOCS_REVIEW"] } }] } },
    },
    select: { id: true },
    take: opts.batch ?? 200,
  });
  let n = 0;
  for (const c of candidates) {
    if (await db.$transaction((tx) => anonymizeTx(tx, c.id, null, `retenção de ${settings.retentionMonths} meses`))) n++;
  }
  await db.appSettings.update({ where: { id: 1 }, data: { retentionLastRunAt: now } });
  if (n) log.info("retention.anonymized", { clients: n });
  return { anonymized: n };
}

