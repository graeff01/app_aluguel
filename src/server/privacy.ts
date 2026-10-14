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
import { decryptSecret } from "@/lib/crypto";

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


/**
 * Direito de acesso do titular (LGPD art. 18): tudo o que o app guarda sobre o cliente, em arquivo legível.
 * Inclui pré-análises ligadas pelo telefone (com os dados ainda guardados). Fica na auditoria.
 */
export async function exportClientData(actor: AuthzActor, clientId: string) {
  assert(canManageClients(actor));
  const c = await db.client.findUnique({
    where: { id: clientId },
    include: {
      phones: true,
      visits: {
        orderBy: { scheduledStart: "asc" },
        include: { consultant: { select: { name: true } }, negativeReason: { select: { label: true } }, history: { orderBy: { createdAt: "asc" }, select: { createdAt: true, status: true, note: true } } },
      },
      opportunities: { include: { property: { select: { code: true } }, lostReason: { select: { label: true } }, events: { orderBy: { createdAt: "asc" }, select: { createdAt: true, fromStatus: true, toStatus: true, note: true } } } },
    },
  });
  if (!c) throw notFound();
  const phones = new Set([...c.phones.map((p) => p.normalized), ...c.visits.map((v) => v.phoneNormalized)].filter(Boolean) as string[]);
  const dec = (v: string | null) => {
    if (!v) return null;
    try {
      return decryptSecret(v);
    } catch {
      return null;
    }
  };
  const pres = phones.size
    ? (await db.preAnalysis.findMany({ where: { purgedAt: null, phoneEnc: { not: null } }, include: { consultant: { select: { name: true } } } })).filter((p) => phones.has(dec(p.phoneEnc) ?? ""))
    : [];
  const dt = (d: Date | null) => (d ? d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null);
  const data = {
    geradoEm: dt(new Date()),
    aviso: "Dados pessoais tratados pelo app Visitas Locação sobre o titular (LGPD, art. 18). Uso exclusivo para atender ao pedido do titular.",
    titular: { nome: c.name, telefones: c.phones.map((p) => p.raw), anonimizadoEm: dt(c.anonymizedAt), cadastradoEm: dt(c.createdAt) },
    visitas: c.visits.map((v) => ({
      data: dt(v.scheduledStart),
      imovel: v.propertyCode,
      consultora: v.consultant?.name ?? null,
      situacao: v.status,
      avaliacao: v.evaluation,
      motivo: v.negativeReason?.label ?? null,
      observacao: v.note,
      historico: v.history.map((h) => ({ em: dt(h.createdAt), situacao: h.status, observacao: h.note })),
    })),
    oportunidades: c.opportunities.map((o) => ({ imovel: o.property.code, situacao: o.status, motivoPerda: o.lostReason?.label ?? null, observacaoPerda: o.lostNote, andamento: o.events.map((e) => ({ em: dt(e.createdAt), de: e.fromStatus, para: e.toStatus, observacao: e.note })) })),
    preAnalises: pres.map((p) => ({
      enviadaEm: dt(p.createdAt),
      nomeCompleto: p.fullName,
      cpf: dec(p.cpfEnc),
      nascimento: dec(p.birthDateEnc),
      email: dec(p.emailEnc),
      telefone: dec(p.phoneEnc),
      salarioEmCentavos: dec(p.salaryEnc),
      consultora: p.consultant.name,
      resultado: p.status,
      observacaoResultado: p.resultNote,
    })),
  };
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "client.data_exported", entityType: "Client", entityId: clientId, changes: { visitas: c.visits.length, preAnalises: pres.length } }));
  return data;
}
