/**
 * Reagendamento e nova visita para o mesmo cliente, feitos pela consultora — sem retrabalho:
 * 1) a consultora escolhe a nova data no app; a visita antiga vira "Remarcada" e a nova já existe no sistema;
 * 2) um link abre o Google Agenda dela com o evento PREENCHIDO (título no padrão, data, endereço e a conta central em cópia);
 * 3) a descrição leva o código VL-XXXXXX: a sincronização liga o evento à visita já criada, sem duplicar.
 * O app continua só lendo o Google (nenhuma permissão de edição).
 */
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, canConcludeVisit, type AuthzActor } from "@/lib/authz";
import { fromLocalInput, fmt } from "@/lib/time";
import { getPatternConfig, getSettings } from "@/lib/settings";
import { concludeSameVisit, concludeVisit, ensureProperty } from "./visits";
import { cleanAddress } from "@/lib/address";
import { log } from "@/lib/log";
import type { CalendarApi } from "./sync/types";
import { authorizedClient, canEditEvents, realCalendarApi } from "./sync/google";
import { requestManualSync } from "./sync/runner";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
export const LINK_CODE_RE = /\bVL-([A-HJ-NP-Z2-9]{6})\b/;

export function newLinkCode() {
  const b = randomBytes(6);
  return "VL-" + Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

/**
 * outcome: o que aconteceu com a visita ATUAL (obrigatório quando ela ainda está em aberto):
 * - RESCHEDULED: não aconteceu, o cliente pediu outra data → a nova é "REAGENDADA";
 * - NO_SHOW: o cliente não compareceu → a nova também é remarcação;
 * - DONE: aconteceu e o cliente quer outra visita (avaliação + observação) → a nova é revisita.
 */
export type RescheduleOutcome = { status: "RESCHEDULED" | "NO_SHOW" | "DONE"; evaluation?: "POSITIVE" | "NEGATIVE" | "UNDECIDED" | null; negativeReasonId?: string | null; note?: string };
/** Avisa quando o horário cai em cima de outra visita agendada da consultora (pode ser confirmado). */
export async function assertNoOverlap(consultantId: string, start: Date, end: Date, excludeId?: string) {
  const clash = await db.visit.findFirst({
    where: { consultantId, status: "SCHEDULED", excluded: false, ...(excludeId ? { id: { not: excludeId } } : {}), scheduledStart: { lt: end }, scheduledEnd: { gt: start } },
    orderBy: { scheduledStart: "asc" },
  });
  if (clash) {
    throw new AppError("VALIDATION", `Conflito: já há visita das ${fmt.time(clash.scheduledStart)} às ${fmt.time(clash.scheduledEnd)}${clash.propertyCode ? ` (imóvel ${clash.propertyCode})` : ""} nesse horário. Mude o horário ou confirme.`, { allowOverlap: "Horário em conflito." });
  }
}

export type RescheduleInput = { requestId: string; scheduledStart: string; durationMinutes: number; mode: "reschedule" | "new"; note?: string; propertyCode?: string; outcome?: RescheduleOutcome; allowOverlap?: boolean };

export async function rescheduleVisit(actor: AuthzActor, visitId: string, input: RescheduleInput, now = new Date()) {
  const old = await db.visit.findUnique({ where: { id: visitId } });
  if (!old) throw notFound();
  assert(canConcludeVisit(actor, old));
  if (!old.consultantId) throw new AppError("INVALID_STATE", "Visita sem consultora responsável.");
  if (!old.clientName || !old.propertyCode) throw new AppError("MISSING_DATA", "Complete nome do cliente e código do imóvel antes de reagendar.");
  const start = fromLocalInput(input.scheduledStart);
  if (!start) throw new AppError("VALIDATION", "Informe data e horário.", { scheduledStart: "Data inválida." });
  if (start.getTime() < now.getTime() - 5 * 60_000) throw new AppError("VALIDATION", "Escolha um horário a partir de agora.", { scheduledStart: "Horário já passou." });
  // vários imóveis na mesma visita: "339541;835840" (o 1º fica na visita, os demais viram acompanhantes)
  const codes = [...new Set((input.propertyCode ?? "").split(/[;,]/).map((c) => c.replace(/\s+/g, "").slice(0, 40)).filter(Boolean))];
  if (!codes.length) codes.push(old.propertyCode);
  if (codes.length > 6 || codes.some((c) => !/^[0-9A-Za-z-]{2,40}$/.test(c))) throw new AppError("VALIDATION", "Código do imóvel inválido.", { propertyCode: "Confira o código (vários: separe com ;)." });
  const [code, ...extraCodes] = codes;
  const otherProperty = code !== old.propertyCode;
  const minutes = Math.min(600, Math.max(15, Math.round(input.durationMinutes || 60)));
  const requestId = `resched-${input.requestId}`.slice(0, 100);
  // idempotência: mesmo envio repetido devolve a visita já criada
  const dup = await db.visit.findUnique({ where: { createRequestId: requestId } });
  if (dup) return dup;
  // horário em cima de outra visita da mesma consultora: avisa (pode confirmar)
  if (!input.allowOverlap) await assertNoOverlap(old.consultantId, start, new Date(start.getTime() + minutes * 60_000), old.id);

  // visita atual em aberto: o status dela é registrado aqui mesmo (ela nunca fica "em aberto")
  const outcome: RescheduleOutcome | null = old.status === "SCHEDULED" ? (input.outcome ?? (input.mode === "reschedule" ? { status: "RESCHEDULED" } : null)) : null;
  if (old.status === "SCHEDULED" && !outcome) throw new AppError("INVALID_STATE", "Registre primeiro o resultado desta visita; depois marque a nova.");
  if (outcome && outcome.status !== "RESCHEDULED") {
    // aconteceu / não compareceu: mesmo registro de resultado de sempre (validações, oportunidade, histórico)
    await concludeVisit(actor, old.id, {
      requestId: `${requestId}-atual`.slice(0, 100),
      expectedVersion: old.version,
      status: outcome.status,
      evaluation: outcome.status === "DONE" ? (outcome.evaluation ?? null) : null,
      negativeReasonId: outcome.status === "DONE" && outcome.evaluation === "NEGATIVE" ? (outcome.negativeReasonId ?? null) : null,
      note: outcome.note ?? "",
      applyToSameVisit: outcome.status === "NO_SHOW",
    }, now);
  }
  const reschedule = outcome?.status === "RESCHEDULED";
  // remarcação (inclui não compareceu) leva "REAGENDADA"; depois de uma visita realizada é revisita
  const asReschedule = reschedule || outcome?.status === "NO_SHOW";

  return db.$transaction(async (tx) => {
    if (reschedule) {
      const note = `Remarcada para ${fmt.shortDate(start)} às ${fmt.time(start)}${otherProperty ? ` (imóvel ${code})` : ""}${input.note?.trim() ? ` — ${input.note.trim().slice(0, 300)}` : ""}`;
      await tx.visit.update({ where: { id: old.id }, data: { status: "RESCHEDULED", note, concludedAt: now, concludedById: actor.id, version: { increment: 1 } } });
      await tx.visitOutcomeHistory.create({ data: { visitId: old.id, status: "RESCHEDULED", note, authorId: actor.id } });
      await concludeSameVisit(tx, actor, old, "RESCHEDULED", note, requestId, now);
    }
    const created = await tx.visit.create({
      data: {
        origin: "MANUAL",
        createRequestId: requestId,
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + minutes * 60_000),
        clientName: old.clientName,
        phoneRaw: old.phoneRaw,
        phoneNormalized: old.phoneNormalized,
        propertyCode: code,
        propertyId: otherProperty ? await ensureProperty(tx, code) : old.propertyId,
        clientId: old.clientId,
        clientMatch: old.clientMatch,
        consultantId: old.consultantId,
        assignmentStatus: "MANUAL",
        assignmentNote: asReschedule ? "REAGENDADA" : "NOVA_VISITA_MESMO_CLIENTE",
        scheduledById: actor.role === "CONSULTANT" ? actor.id : old.consultantId,
        rescheduledFromId: old.id,
        linkCode: newLinkCode(),
      },
    });
    for (const extra of extraCodes) {
      await tx.visit.create({
        data: {
          origin: "MANUAL",
          companionOfId: created.id,
          scheduledStart: created.scheduledStart,
          scheduledEnd: created.scheduledEnd,
          clientName: old.clientName,
          phoneRaw: old.phoneRaw,
          phoneNormalized: old.phoneNormalized,
          propertyCode: extra,
          propertyId: await ensureProperty(tx, extra),
          clientId: old.clientId,
          clientMatch: old.clientMatch,
          consultantId: old.consultantId,
          assignmentStatus: "MANUAL",
          assignmentNote: created.assignmentNote,
          scheduledById: created.scheduledById,
          rescheduledFromId: old.id,
        },
      });
    }
    await audit(tx, { actorId: actor.id, action: asReschedule ? "visit.rescheduled" : "visit.revisit_scheduled", entityType: "Visit", entityId: created.id, changes: { anterior: old.id, inicio: start.toISOString(), ...(otherProperty ? { imovelAnterior: old.propertyCode, imovelNovo: code } : {}) } });
    return created;
  });
}

/** Dados do evento da visita marcada no app (título no padrão, descrição com o código VL-, endereço e convidados). */
async function calendarEventData(actor: AuthzActor, visitId: string) {
  const v = await db.visit.findUnique({
    where: { id: visitId },
    include: {
      property: { select: { address: true, neighborhood: true, city: true } },
      consultant: { select: { email: true, aliases: { select: { email: true } } } },
      companions: { where: { excluded: false, status: { not: "CANCELED" } }, select: { propertyCode: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!v) throw notFound();
  assert(canConcludeVisit(actor, v));
  const [patterns, conn, settings] = await Promise.all([getPatternConfig(), db.googleConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } }), getSettings()]);
  const prefix = patterns.visitPrefixes[0] ?? "visita clt";
  const label = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  // a etiqueta vai no FINAL: no começo atrapalharia a leitura do nome do cliente pela sincronização
  const codes = [v.propertyCode, ...v.companions.map((c) => c.propertyCode)].filter(Boolean).join(";");
  const title = [label, v.clientName, codes ? `cod ${codes}` : null, v.phoneRaw, v.assignmentNote === "REAGENDADA" ? "REAGENDADA" : null].filter(Boolean).join(" - ");
  // conta central (para o app ler) + cópias configuradas (ex.: pré-atendimento)
  const cc = settings.calendarCcEmails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
  const central = conn?.calendarId?.includes("@") ? conn.calendarId : conn?.googleEmail;
  const guests = [...new Set([central, ...cc].filter(Boolean) as string[])];
  const details = [
    v.rescheduledFromId ? "Visita remarcada pela consultora no app Visitas Locação." : v.preAnalysisId ? "Visita marcada a partir da pré-análise aprovada (app Visitas Locação)." : "Visita marcada pela consultora no app Visitas Locação.",
    `Ref.: ${v.linkCode ?? ""} (não apague esta linha: liga o evento à visita no app)`,
  ].join("\n");
  const location = cleanAddress(v.property?.address) ?? (v.property?.neighborhood ? `${v.property.neighborhood}, ${v.property.city ?? "Canoas"} - RS` : "");
  // consultora convidada (o evento fica na agenda dela e a atribuição continua certa)
  const consultantEmail = v.consultant?.aliases[0]?.email ?? v.consultant?.email ?? null;
  return { v, conn, title, details, location, guests, central, cc, consultantEmail };
}

/** Link "adicionar evento" do Google Agenda, já preenchido (plano B quando o app não consegue criar sozinho). */
export async function calendarLinkFor(actor: AuthzActor, visitId: string) {
  const { v, title, details, location, guests } = await calendarEventData(actor, visitId);
  const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${utc(v.scheduledStart)}/${utc(v.scheduledEnd)}`, details, ctz: "America/Sao_Paulo" });
  if (location) params.set("location", location);
  if (guests.length) params.set("add", guests.join(","));
  return { url: `https://calendar.google.com/calendar/render?${params.toString()}`, linked: !!v.sourceEventId, created: !!v.googleCreatedAt, code: v.linkCode, title, guests };
}

/**
 * O app cria o evento direto na agenda conectada (precisa da permissão de edição): a consultora não precisa
 * mais tocar em "Colocar na agenda". O código VL- da descrição liga o evento à visita na sincronização.
 */
export async function createVisitEventInGoogle(actor: AuthzActor, visitId: string, opts: { calendarApi?: CalendarApi; now?: Date } = {}): Promise<"created" | "already" | "no_permission" | "error"> {
  const { v, conn, title, details, location, cc, consultantEmail } = await calendarEventData(actor, visitId);
  if (v.sourceEventId || v.googleCreatedAt) return "already";
  if (!v.linkCode || !conn || conn.status !== "CONNECTED" || !conn.calendarId) return "no_permission";
  if (!opts.calendarApi && !canEditEvents(conn.scopes)) return "no_permission";
  try {
    const api = opts.calendarApi ?? realCalendarApi(await authorizedClient(conn.id));
    const attendees = [...new Set([consultantEmail, ...cc].filter((e): e is string => !!e && e.toLowerCase() !== conn.calendarId!.toLowerCase()))];
    const eventId = await api.insertEvent(conn.calendarId, { summary: title, description: details, location, start: v.scheduledStart, end: v.scheduledEnd, attendees });
    await db.$transaction(async (tx) => {
      await tx.visit.update({ where: { id: v.id }, data: { googleCreatedAt: opts.now ?? new Date() } });
      await audit(tx, { actorId: actor.id, action: "google.event_created", entityType: "Visit", entityId: v.id, changes: { evento: eventId } });
    });
    // liga o evento à visita já na próxima rodada (sem esperar os 5 minutos)
    await requestManualSync(actor.id).catch(() => undefined);
    return "created";
  } catch (e) {
    log.warn("google.insert_failed", { kind: (e as { kind?: string }).kind ?? "OTHER" });
    return "error";
  }
}
