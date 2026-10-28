/**
 * Cliente em busca: recusou um imóvel, mas segue procurando outro (outro perfil).
 * Fica separado do negócio (cliente + imóvel) para não inflar o funil: o negócio do imóvel recusado continua "Caiu".
 *
 * - nasce na visita negativa ("segue procurando") ou no negócio que caiu;
 * - perfil opcional (valor, regiões, tipo, quartos, o que não quer);
 * - a consultora registra contatos e combina o próximo ("ligar em 3 dias");
 * - sem contato há SEARCH_STALE_DAYS dias: destacada como esfriando;
 * - termina sozinha como "Alugou conosco" quando um contrato do cliente é assinado.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ClientSearchStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, canViewOpportunity, canViewVisit, hasGlobalView, visitScope, type AuthzActor } from "@/lib/authz";
import { addDays, dateOnlyFromKey, dateOnlyKey, dayKey } from "@/lib/time";
import { parseMoney } from "./pre-analysis";

export const SEARCH_STALE_DAYS = 7;
export const DEFAULT_SEARCH_FOLLOWUP_DAYS = 3;
const DAY = 86400_000;

export const PROPERTY_TYPES = ["Apartamento", "Casa", "Sobrado", "Kitnet / studio", "Cobertura", "Comercial"] as const;

export const SEARCH_CLOSE_LABEL: Record<Exclude<ClientSearchStatus, "ACTIVE">, string> = {
  WON: "Alugou conosco",
  LOST_ELSEWHERE: "Alugou em outro lugar",
  GAVE_UP: "Desistiu / parou de responder",
};

export type SearchProfileInput = { maxBudget?: string; areas?: string; propertyType?: string; bedrooms?: string; mustNot?: string; note?: string };

const profileSchema = z.object({
  maxBudget: z.string().max(30).optional(),
  areas: z.string().max(300).optional(),
  propertyType: z.string().max(40).optional(),
  bedrooms: z.string().max(2).optional(),
  mustNot: z.string().max(300).optional(),
  note: z.string().max(1500).optional(),
});

/** Converte o formulário em campos do banco (só o que foi informado; vazio limpa o campo). */
export function parseProfile(input: SearchProfileInput): Prisma.ClientSearchUpdateInput {
  const p = profileSchema.parse(input);
  const out: Prisma.ClientSearchUpdateInput = {};
  if (p.maxBudget !== undefined) {
    if (!p.maxBudget.trim()) out.maxBudgetCents = null;
    else {
      const cents = parseMoney(p.maxBudget);
      if (cents === null || cents < 30000 || cents > 10_000_000) throw new AppError("VALIDATION", "Valor máximo inválido. Ex.: 2.500", { maxBudget: "Valor inválido." });
      out.maxBudgetCents = cents;
    }
  }
  if (p.areas !== undefined)
    out.areas = [...new Set(p.areas.split(/[,;\n]/).map((a) => a.trim().replace(/\s+/g, " ")).filter(Boolean))].slice(0, 8).map((a) => a.slice(0, 40));
  if (p.propertyType !== undefined) out.propertyType = (PROPERTY_TYPES as readonly string[]).includes(p.propertyType) ? p.propertyType : null;
  if (p.bedrooms !== undefined) {
    const n = Number(p.bedrooms);
    out.bedrooms = p.bedrooms.trim() && Number.isInteger(n) && n >= 0 && n <= 6 ? n : null;
  }
  if (p.mustNot !== undefined) out.mustNot = p.mustNot.trim() || null;
  if (p.note !== undefined) out.note = p.note.trim() || null;
  return out;
}

function canManageSearch(a: AuthzActor, s: { consultantId: string }) {
  return hasGlobalView(a) || s.consultantId === a.id;
}

const today = (now: Date) => dateOnlyFromKey(dayKey(now));

/** Começa (ou atualiza) a busca do cliente a partir de uma visita ou de um negócio que caiu. */
export async function startClientSearch(actor: AuthzActor, from: { visitId?: string; opportunityId?: string }, profile: SearchProfileInput = {}, now = new Date()) {
  let clientId: string | null = null;
  let consultantId: string | null = null;
  let sourceVisitId: string | null = null;
  let origin = "";
  if (from.visitId) {
    const v = await db.visit.findUnique({ where: { id: from.visitId }, include: { negativeReason: true } });
    if (!v) throw notFound();
    assert(canViewVisit(actor, v));
    clientId = v.clientId;
    consultantId = v.consultantId;
    sourceVisitId = v.id;
    origin = `Recusou o imóvel ${v.propertyCode ?? "—"}${v.negativeReason ? ` (${v.negativeReason.label.toLowerCase()})` : ""} em ${dateOnlyKey(today(v.scheduledStart)).split("-").reverse().join("/")}.`;
  } else if (from.opportunityId) {
    const o = await db.opportunity.findUnique({ where: { id: from.opportunityId }, include: { property: true, lostReason: true, visits: { orderBy: { scheduledStart: "desc" }, take: 1, select: { id: true } } } });
    if (!o) throw notFound();
    assert(canViewOpportunity(actor, o));
    clientId = o.clientId;
    consultantId = o.responsibleId;
    sourceVisitId = o.visits[0]?.id ?? null;
    origin = `Não seguiu com o imóvel ${o.property.code}${o.lostReason ? ` (${o.lostReason.label.toLowerCase()})` : ""}.`;
  } else throw new AppError("VALIDATION", "Busca sem visita nem negócio de origem.");
  if (!clientId) throw new AppError("MISSING_DATA", "Esta visita ainda não tem o cliente identificado. Complete o telefone do cliente e tente de novo.");
  if (actor.role === "CONSULTANT") consultantId = actor.id;
  if (!consultantId) throw new AppError("VALIDATION", "Defina a consultora responsável pela visita antes.");

  const data = parseProfile(profile);
  const active = await db.clientSearch.findFirst({ where: { clientId, status: "ACTIVE" } });
  if (active) {
    assert(canManageSearch(actor, active));
    await db.$transaction(async (tx) => {
      await tx.clientSearch.update({ where: { id: active.id }, data: { ...data, note: data.note === undefined ? appendNote(active.note, origin) : data.note } });
      await audit(tx, { actorId: actor.id, action: "client_search.updated", entityType: "ClientSearch", entityId: active.id });
    });
    return { id: active.id, created: false };
  }
  try {
    const created = await db.$transaction(async (tx) => {
      const s = await tx.clientSearch.create({
        data: {
          clientId: clientId!,
          consultantId: consultantId!,
          createdById: actor.id,
          sourceVisitId,
          startedAt: now,
          lastContactAt: now,
          followUpOn: dateOnlyFromKey(addDays(dayKey(now), DEFAULT_SEARCH_FOLLOWUP_DAYS)),
          maxBudgetCents: data.maxBudgetCents as number | null | undefined,
          areas: (data.areas as string[] | undefined) ?? [],
          propertyType: data.propertyType as string | null | undefined,
          bedrooms: data.bedrooms as number | null | undefined,
          mustNot: data.mustNot as string | null | undefined,
          note: (data.note as string | null | undefined) ?? origin,
        },
      });
      await audit(tx, { actorId: actor.id, action: "client_search.started", entityType: "ClientSearch", entityId: s.id, changes: { origem: from.visitId ? "visita" : "negócio" } });
      return s;
    });
    return { id: created.id, created: true };
  } catch (e) {
    // corrida: outra busca ativa criada ao mesmo tempo (índice parcial)
    if ((e as { code?: string }).code === "P2002") {
      const again = await db.clientSearch.findFirst({ where: { clientId, status: "ACTIVE" } });
      if (again) return { id: again.id, created: false };
    }
    throw e;
  }
}

function appendNote(current: string | null, line: string) {
  if (!line || current?.includes(line)) return current;
  return [current, line].filter(Boolean).join("\n").slice(-1500);
}

async function loadManaged(actor: AuthzActor, id: string) {
  const s = await db.clientSearch.findUnique({ where: { id } });
  if (!s) throw notFound();
  assert(canManageSearch(actor, s));
  return s;
}

export async function updateSearchProfile(actor: AuthzActor, id: string, profile: SearchProfileInput) {
  const s = await loadManaged(actor, id);
  if (s.status !== "ACTIVE") throw new AppError("INVALID_STATE", "Esta busca já foi encerrada.");
  await db.$transaction(async (tx) => {
    await tx.clientSearch.update({ where: { id }, data: parseProfile(profile) });
    await audit(tx, { actorId: actor.id, action: "client_search.profile_updated", entityType: "ClientSearch", entityId: id });
  });
}

/** Registrou um contato com o cliente; combina quando falar de novo (null = sem data). */
export async function logSearchContact(actor: AuthzActor, id: string, input: { note?: string; followUpDays: number | null }, now = new Date()) {
  const s = await loadManaged(actor, id);
  if (s.status !== "ACTIVE") throw new AppError("INVALID_STATE", "Esta busca já foi encerrada.");
  if (input.followUpDays !== null && (!Number.isInteger(input.followUpDays) || input.followUpDays < 1 || input.followUpDays > 60)) throw new AppError("VALIDATION", "Prazo inválido.");
  const note = input.note?.trim().slice(0, 300);
  const stamp = dayKey(now).split("-").reverse().slice(0, 2).join("/");
  await db.$transaction(async (tx) => {
    await tx.clientSearch.update({
      where: { id },
      data: {
        lastContactAt: now,
        followUpOn: input.followUpDays === null ? null : dateOnlyFromKey(addDays(dayKey(now), input.followUpDays)),
        ...(note ? { note: appendNote(s.note, `${stamp}: ${note}`) } : {}),
      },
    });
    await audit(tx, { actorId: actor.id, action: "client_search.contact", entityType: "ClientSearch", entityId: id });
  });
}

export async function closeClientSearch(actor: AuthzActor, id: string, outcome: string, note: string, now = new Date()) {
  const s = await loadManaged(actor, id);
  if (s.status !== "ACTIVE") throw new AppError("INVALID_STATE", "Esta busca já foi encerrada.");
  if (!["WON", "LOST_ELSEWHERE", "GAVE_UP"].includes(outcome)) throw new AppError("VALIDATION", "Escolha como terminou a busca.", { outcome: "Obrigatório." });
  await db.$transaction(async (tx) => {
    await tx.clientSearch.update({ where: { id }, data: { status: outcome as ClientSearchStatus, closedAt: now, closedById: actor.id, closeNote: note.trim().slice(0, 300) || null, followUpOn: null } });
    await audit(tx, { actorId: actor.id, action: "client_search.closed", entityType: "ClientSearch", entityId: id, changes: { resultado: outcome } });
  });
}

/** Contrato assinado: a busca ativa do cliente termina como "Alugou conosco" (chamado dentro da transação do negócio). */
export async function closeSearchOnWin(tx: Tx, clientId: string, actorId: string | null, now = new Date()) {
  const r = await tx.clientSearch.updateMany({ where: { clientId, status: "ACTIVE" }, data: { status: "WON", closedAt: now, closedById: actorId, closeNote: "Contrato assinado", followUpOn: null } });
  if (r.count) await audit(tx, { actorId, action: "client_search.won", entityType: "Client", entityId: clientId });
}

// ─────────────── Leitura ───────────────

const listInclude = {
  client: { select: { id: true, name: true, anonymizedAt: true, phones: { where: { valid: true }, select: { normalized: true }, take: 1 } } },
  consultant: { select: { id: true, name: true } },
} satisfies Prisma.ClientSearchInclude;

/** Lista com os imóveis que o cliente já viu (no escopo de quem consulta) e os sinais de atenção. */
export async function listClientSearches(actor: AuthzActor, f: { tab?: "ativas" | "encerradas"; consultantId?: string } = {}, now = new Date()) {
  const where: Prisma.ClientSearchWhereInput = {
    ...(hasGlobalView(actor) ? (f.consultantId ? { consultantId: f.consultantId } : {}) : { consultantId: actor.id }),
    ...(f.tab === "encerradas" ? { status: { not: "ACTIVE" } } : { status: "ACTIVE" }),
  };
  const rows = await db.clientSearch.findMany({ where, include: listInclude, orderBy: f.tab === "encerradas" ? { closedAt: "desc" } : { startedAt: "asc" }, take: 200 });
  const seen = rows.length
    ? await db.visit.findMany({
        where: { ...visitScope(actor), clientId: { in: rows.map((r) => r.clientId) }, status: "DONE", excluded: false },
        select: { id: true, clientId: true, propertyCode: true, evaluation: true, scheduledStart: true, negativeReason: { select: { label: true } }, property: { select: { photoUrl: true, neighborhood: true } } },
        orderBy: { scheduledStart: "desc" },
      })
    : [];
  const t = today(now);
  const items = rows.map((r) => {
    const last = r.lastContactAt ?? r.startedAt;
    const silentDays = Math.floor((now.getTime() - last.getTime()) / DAY);
    return {
      ...r,
      phone: r.client.phones[0]?.normalized ?? null,
      days: Math.max(0, Math.floor((now.getTime() - r.startedAt.getTime()) / DAY)),
      silentDays,
      stale: r.status === "ACTIVE" && silentDays >= SEARCH_STALE_DAYS,
      due: r.status === "ACTIVE" && !!r.followUpOn && r.followUpOn <= t,
      seen: seen.filter((v) => v.clientId === r.clientId),
    };
  });
  if (f.tab !== "encerradas") items.sort((a, b) => Number(b.due) - Number(a.due) || Number(b.stale) - Number(a.stale) || b.silentDays - a.silentDays);
  return items;
}

export async function clientSearchDetail(actor: AuthzActor, id: string, now = new Date()) {
  const s = await db.clientSearch.findUnique({ where: { id }, include: listInclude });
  if (!s) throw notFound();
  assert(canManageSearch(actor, s));
  const seen = await db.visit.findMany({
    where: { ...visitScope(actor), clientId: s.clientId, status: { in: ["DONE", "SCHEDULED"] }, excluded: false },
    select: { id: true, status: true, propertyCode: true, evaluation: true, scheduledStart: true, negativeReason: { select: { label: true } }, property: { select: { photoUrl: true, neighborhood: true, title: true } } },
    orderBy: { scheduledStart: "desc" },
  });
  const silentDays = Math.floor((now.getTime() - (s.lastContactAt ?? s.startedAt).getTime()) / DAY);
  return {
    ...s,
    phone: s.client.phones[0]?.normalized ?? null,
    days: Math.max(0, Math.floor((now.getTime() - s.startedAt.getTime()) / DAY)),
    silentDays,
    stale: s.status === "ACTIVE" && silentDays >= SEARCH_STALE_DAYS,
    due: s.status === "ACTIVE" && !!s.followUpOn && s.followUpOn <= today(now),
    seen,
    // visita mais recente: base para "marcar visita em outro imóvel" (já puxa o cliente)
    lastVisitId: seen.find((v) => v.status === "DONE")?.id ?? seen[0]?.id ?? null,
  };
}

/** Resumo para Minhas visitas: ativas, para ligar hoje e esfriando. */
export async function searchSummaryFor(actor: AuthzActor, now = new Date()) {
  const rows = await db.clientSearch.findMany({ where: { consultantId: actor.id, status: "ACTIVE" }, select: { followUpOn: true, lastContactAt: true, startedAt: true } });
  const t = today(now);
  return {
    active: rows.length,
    due: rows.filter((r) => r.followUpOn && r.followUpOn <= t).length,
    stale: rows.filter((r) => now.getTime() - (r.lastContactAt ?? r.startedAt).getTime() >= SEARCH_STALE_DAYS * DAY).length,
  };
}

/** Indicadores para a gestão (período: buscas encerradas desde `from`). */
export async function searchStats(actor: AuthzActor, from: Date, now = new Date()) {
  assert(hasGlobalView(actor));
  const [active, closed] = await Promise.all([
    db.clientSearch.findMany({ where: { status: "ACTIVE" }, select: { consultantId: true, lastContactAt: true, startedAt: true } }),
    db.clientSearch.findMany({ where: { status: { not: "ACTIVE" }, closedAt: { gte: from } }, select: { status: true, startedAt: true, closedAt: true } }),
  ]);
  const won = closed.filter((c) => c.status === "WON");
  return {
    active: active.length,
    stale: active.filter((r) => now.getTime() - (r.lastContactAt ?? r.startedAt).getTime() >= SEARCH_STALE_DAYS * DAY).length,
    won: won.length,
    lostElsewhere: closed.filter((c) => c.status === "LOST_ELSEWHERE").length,
    gaveUp: closed.filter((c) => c.status === "GAVE_UP").length,
    conversion: closed.length ? won.length / closed.length : null,
    avgDaysToWin: won.length ? Math.round(won.reduce((a, c) => a + (c.closedAt!.getTime() - c.startedAt.getTime()) / DAY, 0) / won.length) : null,
  };
}

/** Opções do site enviadas ao cliente em busca: não voltam como sugestão, ficam na observação e conta como contato. */
export async function searchOptionsSent(actor: AuthzActor, id: string, codes: string[], via: "whatsapp" | "manual", now = new Date()) {
  const s = await loadManaged(actor, id);
  if (s.status !== "ACTIVE") throw new AppError("INVALID_STATE", "Esta busca já foi encerrada.");
  const list = [...new Set(codes)].filter((c) => /^[\w-]{2,40}$/.test(c)).slice(0, 6);
  if (!list.length) throw new AppError("VALIDATION", "Escolha ao menos uma opção.");
  const stamp = dayKey(now).split("-").reverse().slice(0, 2).join("/");
  await db.$transaction(async (tx) => {
    await tx.clientSearch.update({
      where: { id },
      data: {
        sentCodes: [...new Set([...s.sentCodes, ...list])].slice(-100),
        siteNewCodes: s.siteNewCodes.filter((c) => !list.includes(c)),
        lastContactAt: now,
        followUpOn: dateOnlyFromKey(addDays(dayKey(now), 2)),
        note: appendNote(s.note, `${stamp}: opções ${via === "whatsapp" ? "enviadas pelo WhatsApp" : "indicadas"}: ${list.join(", ")}`),
      },
    });
    await audit(tx, { actorId: actor.id, action: "client_search.options_sent", entityType: "ClientSearch", entityId: id, changes: { imoveis: list } });
  });
}
