/**
 * Pré-análise (antes de agendar visita): o pré-atendimento cadastra os dados do TITULAR do CPF e encaminha a uma
 * consultora, que faz a análise fora do sistema e registra o resultado (aprovado, reprovado ou pendente).
 *
 * LGPD: finalidade = análise prévia para locação (procedimento preliminar de contrato, a pedido do titular).
 * - CPF, nascimento, e-mail, telefone e salário: CRIPTOGRAFADOS (AES-256-GCM); CPF também como HMAC para detectar repetição.
 * - Acesso: pré-atendimento, gestão e a consultora encaminhada. Cada abertura do detalhe fica na auditoria.
 * - Retenção: apagados N dias após o resultado (padrão 90); ficam nome, faixa de renda, resultado e datas.
 * - Notificações nunca levam dados do cliente.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { AppError, notFound } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { assert, canCreatePreAnalysis, canResolvePreAnalysis, canViewPreAnalysis, hasGlobalView, isPreService, preAnalysisScope, type AuthzActor } from "@/lib/authz";
import { normalizePhone } from "@/lib/phone";
import { normalizeEmail } from "@/lib/text";
import { getSettings } from "@/lib/settings";
import { pushConfig, sendPush } from "@/lib/push";
import { log } from "@/lib/log";
import { notifyUser } from "./notify";
import { dayKey } from "@/lib/time";
import type { PreAnalysisStatus } from "@/generated/prisma/enums";

const DAY = 86400_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ─────────────── validações ───────────────

export { cpfDigits, isValidCpf } from "@/lib/cpf";
import { cpfDigits, isValidCpf } from "@/lib/cpf";

export function formatCpf(d: string) {
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
}
export const maskCpf = (d: string) => (d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "***");

/** "4.500,00", "4500", "R$ 4.500" → centavos. */
export function parseMoney(raw: string): number | null {
  const t = raw.replace(/[^\d,.]/g, "");
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /\.\d{1,2}$/.test(t) ? t : t.replace(/\./g, "");
  const n = Math.round(Number(normalized) * 100);
  return Number.isFinite(n) && n > 0 && n < 10_000_000_00 ? n : null;
}

export function incomeBand(cents: number) {
  const r = cents / 100;
  return r <= 2000 ? "ate2k" : r <= 4000 ? "2a4k" : r <= 6000 ? "4a6k" : r <= 10000 ? "6a10k" : "10kmais";
}

export function ageOn(birth: string, now: Date) {
  const [y, m, d] = birth.split("-").map(Number);
  const t = new Date(now);
  let age = t.getUTCFullYear() - y;
  if (t.getUTCMonth() + 1 < m || (t.getUTCMonth() + 1 === m && t.getUTCDate() < d)) age--;
  return age;
}

function cpfHash(digits: string) {
  return createHmac("sha256", Buffer.from(env.tokenKey, "base64")).update(`cpf:${digits}`).digest("base64url");
}

const createSchema = z.object({
  fullName: z.string().trim().min(5, "Informe o nome completo.").max(160),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  cpf: z.string(),
  email: z.string().trim().max(160),
  phone: z.string().trim().max(40),
  salary: z.string().trim().max(30),
  consultantId: z.string().min(1, "Escolha a consultora."),
  guaranteeId: z.string().min(1, "Escolha a garantia."),
  propertyCode: z.string().trim().max(40).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
  holderConfirmed: z.literal(true, { message: "Confirme que os dados são do titular do CPF." }),
  /** idempotência: o mesmo envio repetido não duplica */
  requestId: z.string().max(100).optional(),
  /** CPF já analisado há pouco: só segue com confirmação explícita */
  confirmRepeat: z.boolean().optional(),
  /** consultora marcada como ausente: só segue com confirmação explícita */
  confirmAway: z.boolean().optional(),
});

export async function createPreAnalysis(actor: AuthzActor, input: z.input<typeof createSchema>, now = new Date()) {
  assert(canCreatePreAnalysis(actor));
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Revise os campos destacados.", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
  const p = parsed.data;
  if (p.requestId) {
    const dup = await db.preAnalysis.findUnique({ where: { requestId: p.requestId } });
    if (dup) return dup;
  }
  const errors: Record<string, string> = {};
  const cpf = cpfDigits(p.cpf);
  if (!isValidCpf(cpf)) errors.cpf = "CPF inválido (confira os números).";
  const age = ageOn(p.birthDate, now);
  if (!(age >= 18 && age <= 110)) errors.birthDate = "O titular precisa ter 18 anos ou mais.";
  const email = normalizeEmail(p.email);
  if (!EMAIL_RE.test(email)) errors.email = "E-mail inválido.";
  const phone = normalizePhone(p.phone);
  if (!phone.valid || !phone.normalized) errors.phone = "Telefone inválido (DDD + número).";
  const salary = parseMoney(p.salary);
  if (!salary) errors.salary = "Informe o salário (ex.: 4.500,00).";
  if (Object.keys(errors).length) throw new AppError("VALIDATION", "Revise os campos destacados.", errors);
  const guarantee = await db.reason.findUnique({ where: { id: p.guaranteeId } });
  if (!guarantee || guarantee.kind !== "GUARANTEE" || !guarantee.active) throw new AppError("VALIDATION", "Escolha a garantia.", { guaranteeId: "Garantia inválida." });
  const consultant = await db.user.findUnique({ where: { id: p.consultantId } });
  if (!consultant || consultant.role !== "CONSULTANT" || !consultant.active) throw new AppError("VALIDATION", "Escolha uma consultora ativa.", { consultantId: "Consultora inválida." });
  if (isAway(consultant.awayUntil, now) && !p.confirmAway) {
    throw new AppError("VALIDATION", `${consultant.name.split(" ")[0]} está ausente até ${fmtDay(consultant.awayUntil!)}. Escolha outra consultora ou confirme o envio.`, { confirmAway: "Consultora ausente." });
  }
  // mesmo CPF: em aberto bloqueia; analisado nos últimos 30 dias pede confirmação
  const hash = cpfHash(cpf);
  const open = await db.preAnalysis.findFirst({ where: { cpfHash: hash, status: { in: ["AWAITING", "PENDING"] } }, include: { consultant: { select: { name: true } } } });
  if (open) throw new AppError("CONFLICT", `Este CPF já tem uma pré-análise em aberto com ${open.consultant.name.split(" ")[0]} (enviada em ${open.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}). Acompanhe por ela.`, { cpf: "Pré-análise em aberto." });
  const recent = await db.preAnalysis.findFirst({ where: { cpfHash: hash, resultAt: { gte: new Date(now.getTime() - 30 * DAY) } }, orderBy: { resultAt: "desc" } });
  if (recent && !p.confirmRepeat) {
    throw new AppError("VALIDATION", `Este CPF teve pré-análise respondida em ${recent.resultAt!.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} (${recent.status === "APPROVED" ? "aprovado" : recent.status === "REJECTED" ? "reprovado" : "pendente"}). Confirme para enviar de novo.`, { confirmRepeat: "CPF analisado há pouco." });
  }

  const created = await db.$transaction(async (tx) => {
    const row = await tx.preAnalysis.create({
      data: {
        requestId: p.requestId || null,
        createdById: actor.id,
        consultantId: consultant.id,
        fullName: p.fullName.replace(/\s+/g, " "),
        cpfHash: hash,
        cpfEnc: encryptSecret(cpf),
        birthDateEnc: encryptSecret(p.birthDate),
        emailEnc: encryptSecret(email),
        phoneEnc: encryptSecret(phone.normalized!),
        salaryEnc: encryptSecret(String(salary)),
        incomeBand: incomeBand(salary!),
        propertyCode: p.propertyCode || null,
        guaranteeId: guarantee.id,
        note: p.note || null,
      },
    });
    await audit(tx, { actorId: actor.id, action: "preanalysis.created", entityType: "PreAnalysis", entityId: row.id, changes: { consultora: consultant.id } });
    return row;
  });
  await notifyUser(consultant.id, { title: "Nova pré-análise para você", body: `Garantia: ${guarantee.label}. Toque para ver os dados e responder.`, url: `/pre-analises/${created.id}`, tag: `pre-${created.id}` });
  return created;
}

// ─────────────── leitura ───────────────

export async function listPreAnalyses(actor: AuthzActor, f: { tab?: "abertas" | "respondidas"; q?: string } = {}) {
  assert(canCreatePreAnalysis(actor) || actor.role === "CONSULTANT");
  const open = f.tab !== "respondidas";
  return db.preAnalysis.findMany({
    where: {
      ...preAnalysisScope(actor),
      status: open ? { in: ["AWAITING", "PENDING"] } : { in: ["APPROVED", "REJECTED"] },
      ...(f.q ? { fullName: { contains: f.q.trim(), mode: "insensitive" } } : {}),
    },
    orderBy: open ? { createdAt: "asc" } : { resultAt: "desc" },
    take: 200,
    select: { id: true, fullName: true, status: true, incomeBand: true, propertyCode: true, createdAt: true, resultAt: true, purgedAt: true, consultant: { select: { id: true, name: true } }, createdBy: { select: { name: true } } },
  });
}

export async function countOpenFor(actor: AuthzActor) {
  if (actor.role === "CONSULTANT") return db.preAnalysis.count({ where: { consultantId: actor.id, status: { in: ["AWAITING", "PENDING"] } } });
  if (isPreService(actor) || hasGlobalView(actor)) return db.preAnalysis.count({ where: { status: "AWAITING" } });
  return 0;
}

const dec = (v: string | null) => {
  if (!v) return null;
  try {
    return decryptSecret(v);
  } catch {
    return null;
  }
};

/** Detalhe com os dados abertos (auditado). */
export async function preAnalysisDetail(actor: AuthzActor, id: string, now = new Date()) {
  const p = await db.preAnalysis.findUnique({
    where: { id },
    include: {
      consultant: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      resultBy: { select: { name: true } },
      visits: { orderBy: { scheduledStart: "asc" }, select: { id: true, scheduledStart: true, status: true, propertyCode: true, sourceEventId: true } },
    },
  });
  if (!p) throw notFound();
  assert(canViewPreAnalysis(actor, p));
  const cpf = dec(p.cpfEnc);
  const birth = dec(p.birthDateEnc);
  const salary = dec(p.salaryEnc);
  const previous = p.cpfHash
    ? await db.preAnalysis.findMany({
        where: { cpfHash: p.cpfHash, id: { not: p.id }, ...preAnalysisScope(actor) },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, createdAt: true, status: true, consultant: { select: { name: true } } },
      })
    : [];
  if (!p.purgedAt) await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "preanalysis.viewed", entityType: "PreAnalysis", entityId: p.id }));
  const settings = await getSettings();
  return {
    ...p,
    cpf,
    birthDate: birth,
    age: birth ? ageOn(birth, now) : null,
    email: dec(p.emailEnc),
    phone: dec(p.phoneEnc),
    salaryCents: salary ? Number(salary) : null,
    previous,
    purgeAt: p.purgedAt ? null : new Date((p.resultAt ?? p.createdAt).getTime() + settings.preAnalysisRetentionDays * DAY),
    retentionDays: settings.preAnalysisRetentionDays,
    canResolve: canResolvePreAnalysis(actor, p),
    canDelete: p.status === "AWAITING" && (p.createdById === actor.id || hasGlobalView(actor)),
  };
}

// ─────────────── resultado ───────────────

export async function resolvePreAnalysis(actor: AuthzActor, id: string, input: { status: string; note: string }, now = new Date()) {
  const p = await db.preAnalysis.findUnique({ where: { id } });
  if (!p) throw notFound();
  assert(canResolvePreAnalysis(actor, p));
  if (p.purgedAt) throw new AppError("INVALID_STATE", "Os dados desta pré-análise já foram apagados (prazo da LGPD).");
  const status = input.status as PreAnalysisStatus;
  if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) throw new AppError("VALIDATION", "Escolha o resultado.", { status: "Escolha o resultado." });
  const note = input.note.trim();
  if (note.length < 3) throw new AppError("VALIDATION", "Escreva uma observação (ex.: o que falta ou o motivo).", { note: "Obrigatória." });
  await db.$transaction(async (tx) => {
    await tx.preAnalysis.update({ where: { id }, data: { status, resultNote: note.slice(0, 1000), resultAt: now, resultById: actor.id } });
    await audit(tx, { actorId: actor.id, action: "preanalysis.resolved", entityType: "PreAnalysis", entityId: id, changes: { de: p.status, para: status } });
  });
  const label = status === "APPROVED" ? "aprovada" : status === "REJECTED" ? "reprovada" : "pendente";
  await notifyUser(p.createdById, { title: `Pré-análise ${label}`, body: "A consultora respondeu. Toque para ver.", url: `/pre-analises/${id}`, tag: `pre-${id}` });
  return status;
}

/** Excluir (digitação errada, enviada por engano): só enquanto aguarda análise. */
export async function deletePreAnalysis(actor: AuthzActor, id: string) {
  const p = await db.preAnalysis.findUnique({ where: { id } });
  if (!p) throw notFound();
  assert(p.status === "AWAITING" && (p.createdById === actor.id || hasGlobalView(actor)), "Só dá para excluir enquanto aguarda análise.");
  await db.$transaction(async (tx) => {
    await tx.preAnalysis.delete({ where: { id } });
    await audit(tx, { actorId: actor.id, action: "preanalysis.deleted", entityType: "PreAnalysis", entityId: id });
  });
}

// ─────────────── retenção (LGPD) ───────────────

export async function runPreAnalysisRetention(now = new Date()) {
  const settings = await getSettings();
  const limit = new Date(now.getTime() - settings.preAnalysisRetentionDays * DAY);
  const r = await db.preAnalysis.updateMany({
    where: {
      purgedAt: null,
      OR: [
        { status: { in: ["APPROVED", "REJECTED"] }, resultAt: { lt: limit } },
        // abertas há mais que o prazo (sem resposta): também saem
        { status: { in: ["AWAITING", "PENDING"] }, createdAt: { lt: limit } },
      ],
    },
    data: { cpfEnc: null, birthDateEnc: null, emailEnc: null, phoneEnc: null, salaryEnc: null, cpfHash: null, purgedAt: now },
  });
  if (r.count) {
    log.info("preanalysis.purged", { count: r.count });
    await db.$transaction((tx) => audit(tx, { actorId: null, action: "preanalysis.purged", entityType: "PreAnalysis", entityId: "-", changes: { quantidade: r.count, dias: settings.preAnalysisRetentionDays } }));
  }
  return { purged: r.count };
}

// ─────────────── indicadores ───────────────

export async function preAnalysisStats(actor: AuthzActor, from: Date, to: Date, opts: { senderId?: string } = {}) {
  assert(hasGlobalView(actor) || isPreService(actor));
  const rows = await db.preAnalysis.findMany({
    where: { createdAt: { gte: from, lt: to }, ...(opts.senderId ? { createdById: opts.senderId } : {}) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      status: true,
      incomeBand: true,
      propertyCode: true,
      resultNote: true,
      createdAt: true,
      resultAt: true,
      consultant: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      guarantee: { select: { label: true } },
      visits: { select: { status: true, opportunity: { select: { status: true } } } },
    },
  });
  const decided = rows.filter((r) => r.status === "APPROVED" || r.status === "REJECTED");
  const approved = rows.filter((r) => r.status === "APPROVED").length;
  const answered = rows.filter((r) => r.resultAt);
  const hours = answered.map((r) => (r.resultAt!.getTime() - r.createdAt.getTime()) / 3600_000);
  const by = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, { total: number; approved: number; rejected: number; pending: number; awaiting: number }>();
    for (const r of rows) {
      const k = key(r);
      const e = m.get(k) ?? { total: 0, approved: 0, rejected: 0, pending: 0, awaiting: 0 };
      e.total++;
      if (r.status === "APPROVED") e.approved++;
      else if (r.status === "REJECTED") e.rejected++;
      else if (r.status === "PENDING") e.pending++;
      else e.awaiting++;
      m.set(k, e);
    }
    return m;
  };
  return {
    total: rows.length,
    approved,
    rejected: decided.length - approved,
    pending: rows.filter((r) => r.status === "PENDING").length,
    awaiting: rows.filter((r) => r.status === "AWAITING").length,
    approvalRate: decided.length ? approved / decided.length : null,
    // funil: pré-análise → visita (marcada pelo app) → visita realizada → locação
    withVisit: rows.filter((r) => r.visits.length > 0).length,
    visited: rows.filter((r) => r.visits.some((v) => v.status === "DONE")).length,
    leased: rows.filter((r) => r.visits.some((v) => v.opportunity?.status === "CLOSED_WON")).length,
    avgResponseHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    byConsultant: [...by((r) => r.consultant.name).entries()].sort((a, b) => b[1].total - a[1].total),
    byIncome: [...by((r) => r.incomeBand).entries()],
    byGuarantee: [...by((r) => r.guarantee?.label ?? "Não informada").entries()].sort((a, b) => b[1].total - a[1].total),
    bySender: [...by((r) => r.createdBy.name).entries()].sort((a, b) => b[1].total - a[1].total),
    // semana (segunda-feira) no fuso de São Paulo
    byWeek: [...by((r) => weekStart(r.createdAt)).entries()].sort((a, b) => a[0].localeCompare(b[0])),
    rows,
  };
}

function weekStart(d: Date) {
  const key = dayKey(d);
  const local = new Date(`${key}T12:00:00Z`);
  local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  return local.toISOString().slice(0, 10);
}

// ─────────────── ausência ───────────────

/** awayUntil é uma data (inclusive): ausente se hoje (Brasília) for até essa data. */
export function isAway(awayUntil: Date | null | undefined, now = new Date()) {
  if (!awayUntil) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  return awayUntil.toISOString().slice(0, 10) >= today;
}
const fmtDay = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().slice(0, 2).join("/");

// ─────────────── rodízio entre consultoras ───────────────

/**
 * Fila de encaminhamento: a próxima da vez é quem está há mais tempo sem receber (quem nunca recebeu vem primeiro);
 * a última a receber fica marcada. Com duas consultoras, isso alterna entre elas.
 */
export async function assignmentQueue(now = new Date()) {
  const consultants = await db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true, awayUntil: true }, orderBy: { name: "asc" } });
  if (!consultants.length) return [];
  const ids = consultants.map((c) => c.id);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 3));
  const [last, month, open] = await Promise.all([
    db.preAnalysis.groupBy({ by: ["consultantId"], where: { consultantId: { in: ids } }, _max: { createdAt: true } }),
    db.preAnalysis.groupBy({ by: ["consultantId"], where: { consultantId: { in: ids }, createdAt: { gte: monthStart } }, _count: { _all: true } }),
    db.preAnalysis.groupBy({ by: ["consultantId"], where: { consultantId: { in: ids }, status: { in: ["AWAITING", "PENDING"] } }, _count: { _all: true } }),
  ]);
  const openCount = new Map(open.map((o) => [o.consultantId, o._count._all]));
  const lastAt = new Map(last.map((l) => [l.consultantId, l._max.createdAt]));
  const monthCount = new Map(month.map((m) => [m.consultantId, m._count._all]));
  const rows = consultants.map((c) => ({ id: c.id, name: c.name, away: isAway(c.awayUntil, now), awayUntil: c.awayUntil ? fmtDay(c.awayUntil) : null, lastAt: lastAt.get(c.id) ?? null, monthCount: monthCount.get(c.id) ?? 0, openCount: openCount.get(c.id) ?? 0 }));
  // ausentes saem da vez (se todas estiverem ausentes, segue o rodízio normal)
  const available = rows.some((r) => !r.away) ? rows.filter((r) => !r.away) : rows;
  // menos pré-análises em aberto primeiro (ninguém fica sobrecarregada); empate → quem está há mais tempo sem receber
  const byOldest = [...available].sort((a, b) => a.openCount - b.openCount || (a.lastAt?.getTime() ?? 0) - (b.lastAt?.getTime() ?? 0) || a.name.localeCompare(b.name));
  const latest = [...rows].filter((r) => r.lastAt).sort((a, b) => b.lastAt!.getTime() - a.lastAt!.getTime())[0];
  return rows.map((r) => ({ ...r, isNext: r.id === byOldest[0].id, isLast: !!latest && r.id === latest.id && rows.length > 1 }));
}
