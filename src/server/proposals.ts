/**
 * Proposta de aluguel: o pré-atendimento registra o essencial (cliente, telefone, valor proposto e imóvel) e encaminha à
 * consultora da vez. O rodízio é o mesmo da pré-análise: quem recebeu a última pré-análise ou proposta não é a próxima.
 * A consultora acompanha o andamento (enviada ao proprietário → aceita, recusada ou contraproposta) e o pré-atendimento é avisado.
 *
 * LGPD: telefone cifrado (AES-256-GCM) e só a impressão (HMAC) para ligar ao cadastro do cliente; apagado no mesmo prazo
 * da pré-análise depois de encerrada. Notificações nunca levam dados do cliente.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { assert, canCreatePreAnalysis, canUpdateProposal, hasGlobalView, isPreService, proposalScope, type AuthzActor } from "@/lib/authz";
import { normalizePhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/log";
import { PROPOSAL_STATUS_LABEL } from "@/lib/labels";
import { clientByPhone, phoneHash } from "./client-links";
import { notifyUser } from "./notify";
import { assignableConsultant, parseMoney } from "./pre-analysis";
import type { ProposalStatus } from "@/generated/prisma/enums";

const DAY = 86400_000;
export const OPEN_PROPOSAL: ProposalStatus[] = ["NEW", "SENT", "COUNTER"];
export const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const createSchema = z.object({
  clientName: z.string().trim().min(2, "Informe o nome do cliente.").max(160),
  phone: z.string().trim().min(1, "Informe o telefone.").max(40),
  rent: z.string().trim().min(1, "Informe o valor proposto.").max(30),
  propertyCode: z.string().trim().min(1, "Informe o código do imóvel.").max(40),
  consultantId: z.string().min(1, "Escolha a consultora."),
  ownClient: z.boolean().optional().default(false),
  note: z.string().trim().max(1000).optional().default(""),
  requestId: z.string().max(100).optional(),
  confirmAway: z.boolean().optional(),
});

export async function createProposal(actor: AuthzActor, input: z.input<typeof createSchema>, now = new Date()) {
  assert(canCreatePreAnalysis(actor));
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Revise os campos destacados.", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
  const p = parsed.data;
  if (p.requestId) {
    const dup = await db.proposal.findUnique({ where: { requestId: p.requestId } });
    if (dup) return dup;
  }
  const errors: Record<string, string> = {};
  const phone = normalizePhone(p.phone);
  if (!phone.valid || !phone.normalized) errors.phone = "Telefone inválido (DDD + número).";
  const rent = parseMoney(p.rent);
  if (!rent) errors.rent = "Valor inválido (ex.: 2.300,00).";
  const code = p.propertyCode.replace(/\s+/g, "");
  if (!/^[\w-]{2,40}$/.test(code)) errors.propertyCode = "Código do imóvel inválido.";
  if (Object.keys(errors).length) throw new AppError("VALIDATION", "Revise os campos destacados.", errors);
  const consultant = await assignableConsultant(p.consultantId, !!p.confirmAway, now);

  const created = await db.$transaction(async (tx) => {
    const row = await tx.proposal.create({
      data: {
        requestId: p.requestId || null,
        createdById: actor.id,
        consultantId: consultant.id,
        clientName: p.clientName.replace(/\s+/g, " "),
        phoneEnc: encryptSecret(phone.normalized!),
        phoneHash: phoneHash(phone.normalized!),
        clientId: await clientByPhone(tx, phone.normalized!),
        rentCents: rent!,
        propertyCode: code,
        ownClient: p.ownClient,
        note: p.note || null,
      },
    });
    await audit(tx, { actorId: actor.id, action: "proposal.created", entityType: "Proposal", entityId: row.id, changes: { consultora: consultant.id, imovel: code } });
    return row;
  });
  await notifyUser(consultant.id, { title: "Nova proposta para você", body: `Imóvel ${code}. Toque para ver e encaminhar ao proprietário.`, url: `/propostas/${created.id}`, tag: `prop-${created.id}` });
  return created;
}

// ─────────────── leitura ───────────────

export async function listProposals(actor: AuthzActor, f: { tab?: "abertas" | "encerradas"; q?: string } = {}) {
  assert(canCreatePreAnalysis(actor) || actor.role === "CONSULTANT");
  const open = f.tab !== "encerradas";
  return db.proposal.findMany({
    where: {
      ...proposalScope(actor),
      status: open ? { in: OPEN_PROPOSAL } : { in: ["ACCEPTED", "REJECTED"] },
      ...(f.q ? { OR: [{ clientName: { contains: f.q.trim(), mode: "insensitive" } }, { propertyCode: { contains: f.q.trim() } }] } : {}),
    },
    orderBy: open ? { createdAt: "asc" } : { statusAt: "desc" },
    take: 200,
    select: { id: true, clientName: true, status: true, rentCents: true, counterCents: true, propertyCode: true, createdAt: true, statusAt: true, consultant: { select: { id: true, name: true } }, createdBy: { select: { name: true } } },
  });
}

/** Esperando ação: consultora → as novas dela; pré-atendimento e gestão → todas ainda sem resposta da consultora. */
export async function countNewProposalsFor(actor: AuthzActor) {
  if (actor.role === "CONSULTANT") return db.proposal.count({ where: { consultantId: actor.id, status: "NEW" } });
  if (isPreService(actor) || hasGlobalView(actor)) return db.proposal.count({ where: { status: "NEW" } });
  return 0;
}

export async function proposalDetail(actor: AuthzActor, id: string) {
  const p = await db.proposal.findUnique({
    where: { id },
    include: { consultant: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } }, statusBy: { select: { name: true } } },
  });
  if (!p) throw notFound();
  assert(isPreService(actor) || hasGlobalView(actor) || p.consultantId === actor.id);
  let phone: string | null = null;
  try {
    phone = p.phoneEnc ? decryptSecret(p.phoneEnc) : null;
  } catch {}
  if (!p.purgedAt) await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "proposal.viewed", entityType: "Proposal", entityId: p.id }));
  const property = await db.property.findFirst({ where: { code: p.propertyCode }, select: { photoUrl: true, neighborhood: true, title: true } });
  return {
    ...p,
    phone,
    property,
    canUpdate: canUpdateProposal(actor, p),
    canDelete: p.status === "NEW" && (p.createdById === actor.id || hasGlobalView(actor)),
  };
}

// ─────────────── andamento ───────────────

export async function updateProposalStatus(actor: AuthzActor, id: string, input: { status: string; counter?: string; note?: string }, now = new Date()) {
  const p = await db.proposal.findUnique({ where: { id } });
  if (!p) throw notFound();
  assert(canUpdateProposal(actor, p));
  const status = input.status as ProposalStatus;
  if (!["SENT", "COUNTER", "ACCEPTED", "REJECTED"].includes(status)) throw new AppError("VALIDATION", "Escolha o andamento.", { status: "Escolha o andamento." });
  if (status === p.status && status !== "COUNTER") throw new AppError("INVALID_STATE", "A proposta já está nesta situação.");
  const note = (input.note ?? "").trim();
  const counter = status === "COUNTER" ? parseMoney(input.counter ?? "") : null;
  if (status === "COUNTER" && !counter) throw new AppError("VALIDATION", "Informe o valor da contraproposta (ex.: 2.500,00).", { counter: "Informe o valor." });
  if (status === "REJECTED" && note.length < 3) throw new AppError("VALIDATION", "Conte o motivo da recusa.", { note: "Obrigatório na recusa." });
  await db.$transaction(async (tx) => {
    await tx.proposal.update({
      where: { id },
      data: { status, statusAt: now, statusById: actor.id, resultNote: note ? note.slice(0, 1000) : p.resultNote, ...(status === "COUNTER" ? { counterCents: counter } : {}) },
    });
    await audit(tx, { actorId: actor.id, action: "proposal.status_changed", entityType: "Proposal", entityId: id, changes: { de: p.status, para: status, ...(counter ? { contraproposta: counter } : {}) } });
  });
  if (p.createdById !== actor.id) {
    const title = status === "SENT" ? "Proposta enviada ao proprietário" : status === "COUNTER" ? "Contraproposta do proprietário" : `Proposta ${PROPOSAL_STATUS_LABEL[status].toLowerCase()}`;
    await notifyUser(p.createdById, { title, body: `Imóvel ${p.propertyCode}. Toque para ver.`, url: `/propostas/${id}`, tag: `prop-${id}` }).catch(() => undefined);
  }
  return status;
}

/** Excluir (digitação errada, enviada por engano): só enquanto a consultora não deu andamento. */
export async function deleteProposal(actor: AuthzActor, id: string) {
  const p = await db.proposal.findUnique({ where: { id } });
  if (!p) throw notFound();
  assert(p.status === "NEW" && (p.createdById === actor.id || hasGlobalView(actor)), "Só dá para excluir enquanto aguarda a consultora.");
  await db.$transaction(async (tx) => {
    await tx.proposal.delete({ where: { id } });
    await audit(tx, { actorId: actor.id, action: "proposal.deleted", entityType: "Proposal", entityId: id });
  });
}

// ─────────────── retenção (LGPD) ───────────────

/** Telefone apagado N dias depois de encerrada (ou de criada, se ficou aberta além do prazo); ficam nome, valores e datas. */
export async function runProposalRetention(now = new Date()) {
  const settings = await getSettings();
  const limit = new Date(now.getTime() - settings.preAnalysisRetentionDays * DAY);
  const r = await db.proposal.updateMany({
    where: {
      purgedAt: null,
      OR: [
        { status: { in: ["ACCEPTED", "REJECTED"] }, statusAt: { lt: limit } },
        { status: { in: OPEN_PROPOSAL }, createdAt: { lt: limit } },
      ],
    },
    data: { phoneEnc: null, phoneHash: null, purgedAt: now },
  });
  if (r.count) {
    log.info("proposal.purged", { count: r.count });
    await db.$transaction((tx) => audit(tx, { actorId: null, action: "proposal.purged", entityType: "Proposal", entityId: "-", changes: { quantidade: r.count, dias: settings.preAnalysisRetentionDays } }));
  }
  return { purged: r.count };
}
