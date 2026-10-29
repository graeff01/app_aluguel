/**
 * Captação no dia a dia:
 * - retorno das indicações: o que aconteceu com cada imóvel indicado (visita marcada, visitou, alugou, fora do perfil);
 * - "Estou buscando": quem da captação pegou o pedido (evita dois buscando o mesmo);
 * - pedido da consultora a partir do cliente em busca (vai só o perfil; nome e telefone não);
 * - placar do mês (indicados → visitas → alugados) e o "bom dia" das 8h.
 * Nada aqui mostra dados do cliente à captação.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, hasGlobalView, isCapture, type AuthzActor } from "@/lib/authz";
import { addDays, dateOnlyFromKey, dayKey, startOfDayInTz, TZ } from "@/lib/time";
import { notifyUser } from "./notify";
import { alertRadarTeam, notifyCaptureNewRequest, RADAR_FOLLOWUP_DAYS } from "./radar";
import { sendAlerts, usersWithRole } from "./alerts";

const DAY = 86400_000;

// ─────────────── Retorno das indicações ───────────────

export type Outcome = "OFFERED" | "REJECTED" | "VISIT_SCHEDULED" | "VISITED_LIKED" | "VISITED_UNDECIDED" | "VISITED_DISLIKED" | "RENTED";
export const OUTCOME_LABEL: Record<Outcome, string> = {
  OFFERED: "Oferecido ao cliente",
  REJECTED: "Fora do perfil do cliente",
  VISIT_SCHEDULED: "Visita marcada",
  VISITED_LIKED: "Visitou e gostou",
  VISITED_UNDECIDED: "Visitou, está decidindo",
  VISITED_DISLIKED: "Visitou, não gostou",
  RENTED: "Alugou!",
};
export const OUTCOME_TONE: Record<Outcome, "neutral" | "bad" | "warn" | "good"> = {
  OFFERED: "neutral",
  REJECTED: "bad",
  VISIT_SCHEDULED: "warn",
  VISITED_LIKED: "good",
  VISITED_UNDECIDED: "warn",
  VISITED_DISLIKED: "bad",
  RENTED: "good",
};
/** Chegou a visitar (ou marcou) / alugou: para o placar. */
export const reachedVisit = (o: Outcome) => o === "VISIT_SCHEDULED" || o.startsWith("VISITED") || o === "RENTED";

type Ind = { radarId: string; code: string; clientId: string | null; rejectedCodes: string[]; since: Date };
export type IndicationOutcome = { outcome: Outcome; detail: string | null };

/**
 * Retorno de cada indicação (chave radarId|código), olhando as visitas e os negócios do cliente com aquele imóvel
 * (depois da indicação) e as opções marcadas "fora do perfil".
 */
export async function outcomesFor(list: Ind[]): Promise<Map<string, IndicationOutcome>> {
  const out = new Map<string, IndicationOutcome>();
  const clients = [...new Set(list.map((i) => i.clientId).filter((x): x is string => !!x))];
  const codes = [...new Set(list.map((i) => i.code))];
  const [visits, deals] = clients.length
    ? await Promise.all([
        db.visit.findMany({
          where: { clientId: { in: clients }, propertyCode: { in: codes }, excluded: false, status: { in: ["SCHEDULED", "DONE"] } },
          select: { clientId: true, propertyCode: true, status: true, evaluation: true, scheduledStart: true, createdAt: true, negativeReason: { select: { label: true } } },
          orderBy: { scheduledStart: "desc" },
        }),
        db.opportunity.findMany({ where: { clientId: { in: clients }, signedAt: { not: null }, property: { code: { in: codes } } }, select: { clientId: true, property: { select: { code: true } } } }),
      ])
    : [[], []];
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
  for (const i of list) {
    const key = `${i.radarId}|${i.code}`;
    if (i.clientId && deals.some((d) => d.clientId === i.clientId && d.property.code === i.code)) {
      out.set(key, { outcome: "RENTED", detail: null });
      continue;
    }
    // visita marcada depois da indicação (com folga de um dia: às vezes marcam antes de registrar)
    const v = i.clientId ? visits.find((x) => x.clientId === i.clientId && x.propertyCode === i.code && x.createdAt.getTime() >= i.since.getTime() - DAY) : undefined;
    if (v?.status === "DONE")
      out.set(key, v.evaluation === "POSITIVE" ? { outcome: "VISITED_LIKED", detail: null } : v.evaluation === "NEGATIVE" ? { outcome: "VISITED_DISLIKED", detail: v.negativeReason?.label ?? null } : { outcome: "VISITED_UNDECIDED", detail: null });
    else if (v) out.set(key, { outcome: "VISIT_SCHEDULED", detail: fmt.format(v.scheduledStart) });
    else if (i.rejectedCodes.includes(i.code)) out.set(key, { outcome: "REJECTED", detail: null });
    else out.set(key, { outcome: "OFFERED", detail: null });
  }
  return out;
}

export const outcomeText = (o: IndicationOutcome) => `${OUTCOME_LABEL[o.outcome]}${o.detail ? (o.outcome === "VISIT_SCHEDULED" ? ` para ${o.detail}` : `: ${o.detail}`) : ""}`;

// ─────────────── "Estou buscando" ───────────────

/** O captador pega (ou larga) o pedido; quem pediu é avisado quando alguém pega. */
export async function setCaptureOwner(actor: AuthzActor, radarId: string, take: boolean, now = new Date(), notify: typeof notifyUser = notifyUser) {
  assert(isCapture(actor) || hasGlobalView(actor));
  const r = await db.clientRadar.findUnique({ where: { id: radarId } });
  if (!r || !r.sentToCaptureAt) throw notFound();
  if (r.status === "CLOSED") throw new AppError("INVALID_STATE", "Este pedido já foi encerrado.");
  if (take) {
    if (r.captureOwnerId === actor.id) return;
    await db.$transaction(async (tx) => {
      await tx.clientRadar.update({ where: { id: radarId }, data: { captureOwnerId: actor.id, captureOwnerAt: now } });
      await tx.radarEvent.create({ data: { radarId, authorId: actor.id, createdAt: now, note: "Captação: estou buscando." } });
    });
    const first = (await db.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name.split(" ")[0] ?? "A captação";
    await alertRadarTeam(r, { title: `${first} está buscando seu pedido`, body: "A captação pegou o pedido. Você recebe um aviso quando ela indicar um imóvel.", tag: `radar-dono-${radarId}` }, actor.id, notify);
    return;
  }
  if (r.captureOwnerId !== actor.id && !hasGlobalView(actor)) throw new AppError("FORBIDDEN", "Só quem está buscando pode largar o pedido.");
  await db.$transaction(async (tx) => {
    await tx.clientRadar.update({ where: { id: radarId }, data: { captureOwnerId: null, captureOwnerAt: null } });
    await tx.radarEvent.create({ data: { radarId, authorId: actor.id, createdAt: now, note: "Captação: parou de buscar (pedido livre)." } });
  });
}

// ─────────────── Pedido da consultora ───────────────

/** A consultora passa o cliente em busca à captação: vai o perfil e o que o cliente procura (sem nome e telefone). */
export async function requestCaptureFromSearch(actor: AuthzActor, searchId: string, wants: string, now = new Date()) {
  const s = await db.clientSearch.findUnique({ where: { id: searchId }, include: { client: { select: { name: true } }, captureRequest: { select: { id: true, status: true } } } });
  if (!s) throw notFound();
  assert(hasGlobalView(actor) || s.consultantId === actor.id);
  if (s.status !== "ACTIVE") throw new AppError("INVALID_STATE", "Esta busca já foi encerrada.");
  const text = wants.trim().slice(0, 1500);
  if (text.length < 5) throw new AppError("VALIDATION", "Conte o que o cliente procura.", { wants: "Escreva o que ele procura (bairro, valor, o que é importante)." });
  if (!s.areas.length && !s.propertyType && !s.maxBudgetCents) throw new AppError("VALIDATION", "Preencha o perfil (bairro, tipo ou valor) antes de pedir à captação.");
  if (s.captureRequest && s.captureRequest.status !== "CLOSED") throw new AppError("INVALID_STATE", "Este cliente já está com a captação.");
  const data = { wants: text, maxBudgetCents: s.maxBudgetCents, areas: s.areas, propertyType: s.propertyType, bedrooms: s.bedrooms, sentToCaptureAt: now, status: "SEARCHING" as const, lastUpdateAt: now, followUpOn: dateOnlyFromKey(addDays(dayKey(now), RADAR_FOLLOWUP_DAYS)) };
  const radar = await db.$transaction(async (tx) => {
    // pedido anterior encerrado: reabre o mesmo (histórico junto)
    const row = s.captureRequest
      ? await tx.clientRadar.update({ where: { id: s.captureRequest.id }, data: { ...data, closedAt: null, closedById: null, closeReason: null, closeNote: null, captureOwnerId: null, captureOwnerAt: null } })
      : await tx.clientRadar.create({ data: { ...data, createdById: actor.id, clientName: s.client.name, clientId: s.clientId, searchId, createdAt: now } });
    await tx.radarEvent.create({ data: { radarId: row.id, authorId: actor.id, createdAt: now, note: "Pedido da consultora (cliente em busca) passado à captação." } });
    await audit(tx, { actorId: actor.id, action: "client_search.capture_requested", entityType: "ClientSearch", entityId: searchId });
    return row;
  });
  await notifyCaptureNewRequest(radar.id);
  return radar;
}

/** Busca encerrada: o pedido à captação ligado a ela também termina (e a captação é avisada). */
export async function closeCaptureForSearch(actor: AuthzActor | null, searchId: string, outcome: "WON" | "LOST_ELSEWHERE" | "GAVE_UP", now = new Date()) {
  const r = await db.clientRadar.findUnique({ where: { searchId } });
  if (!r || r.status === "CLOSED") return;
  const reason = outcome === "WON" ? "Alugou conosco" : outcome === "LOST_ELSEWHERE" ? "Alugou em outro lugar" : "Desistiu / parou de responder";
  await db.$transaction(async (tx) => {
    await tx.clientRadar.update({ where: { id: r.id }, data: { status: "CLOSED", closedAt: now, closedById: actor?.id ?? null, closeReason: reason, lastUpdateAt: now } });
    await tx.radarEvent.create({ data: { radarId: r.id, authorId: actor?.id ?? null, createdAt: now, note: `Encerrado com a busca do cliente: ${reason}` } });
  });
  await sendAlerts(await usersWithRole("CAPTURE"), { title: "Pedido encerrado: pode parar a busca", body: `${[r.propertyType ?? "Imóvel", r.areas.join(", ")].filter(Boolean).join(" · ")} — ${reason}`, url: "/demanda/pedidos", tag: `captacao-${r.id}` }, { exclude: actor?.id });
}

/** O pedido à captação de um cliente em busca (para a tela da consultora). */
export async function captureForSearch(searchId: string) {
  const r = await db.clientRadar.findUnique({
    where: { searchId },
    select: { id: true, status: true, wants: true, sentToCaptureAt: true, foundCodes: true, rejectedCodes: true, clientId: true, closeReason: true, closedAt: true, marketTag: true, marketNote: true, marketCents: true, captureOwnerAt: true, captureOwner: { select: { name: true } }, indications: { select: { code: true, createdAt: true, by: { select: { name: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!r) return null;
  const outcomes = await outcomesFor(r.indications.map((i) => ({ radarId: r.id, code: i.code, clientId: r.clientId, rejectedCodes: r.rejectedCodes, since: i.createdAt })));
  return { ...r, indications: r.indications.map((i) => ({ ...i, result: outcomes.get(`${r.id}|${i.code}`)! })) };
}

// ─────────────── Placar do mês ───────────────

/** Mês corrente (ou `monthKey` YYYY-MM): por captador, indicados → chegaram a visita → alugados. */
export async function captureScoreboard(actor: AuthzActor, now = new Date(), monthKey?: string) {
  assert(isCapture(actor) || hasGlobalView(actor));
  const key = monthKey ?? dayKey(now).slice(0, 7);
  const start = startOfDayInTz(`${key}-01`);
  const [y, m] = key.split("-").map(Number);
  const end = startOfDayInTz(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`);
  const rows = await db.captureIndication.findMany({
    where: { createdAt: { gte: start, lt: end }, by: { role: "CAPTURE" } },
    select: { radarId: true, code: true, createdAt: true, byId: true, by: { select: { name: true } }, radar: { select: { clientId: true, rejectedCodes: true } } },
  });
  const outcomes = await outcomesFor(rows.map((r) => ({ radarId: r.radarId, code: r.code, clientId: r.radar.clientId, rejectedCodes: r.radar.rejectedCodes, since: r.createdAt })));
  const people = new Map<string, { id: string; name: string; indicated: number; visits: number; rented: number }>();
  for (const u of await db.user.findMany({ where: { role: "CAPTURE", active: true }, select: { id: true, name: true } })) people.set(u.id, { id: u.id, name: u.name, indicated: 0, visits: 0, rented: 0 });
  for (const r of rows) {
    const p = people.get(r.byId) ?? { id: r.byId, name: r.by.name, indicated: 0, visits: 0, rented: 0 };
    const o = outcomes.get(`${r.radarId}|${r.code}`)!.outcome;
    p.indicated++;
    if (reachedVisit(o)) p.visits++;
    if (o === "RENTED") p.rented++;
    people.set(r.byId, p);
  }
  const list = [...people.values()].sort((a, b) => b.rented - a.rented || b.visits - a.visits || b.indicated - a.indicated || a.name.localeCompare(b.name));
  const total = list.reduce((a, p) => ({ indicated: a.indicated + p.indicated, visits: a.visits + p.visits, rented: a.rented + p.rented }), { indicated: 0, visits: 0, rented: 0 });
  const label = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, month: "long" }).format(new Date(start.getTime() + 12 * 3600_000));
  return { month: key, label, people: list, total };
}

// ─────────────── Bom dia da captação ───────────────

const localHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(d));
export const MORNING_HOUR = 8;

/**
 * Às 8h (uma vez por dia por captador): pedidos novos desde ontem, sem ninguém buscando, esperando há 15+ dias e o
 * retorno das indicações dele que mudou. Dia sem nada: não manda.
 */
export async function sendCaptureMorning(now = new Date(), opts: { notify?: typeof notifyUser; force?: boolean } = {}) {
  if (!opts.force && localHour(now) < MORNING_HOUR) return 0;
  const day = dayKey(now);
  const team = await db.user.findMany({ where: { role: "CAPTURE", active: true }, select: { id: true } });
  if (!team.length) return 0;
  const open = await db.clientRadar.findMany({ where: { status: { in: ["SEARCHING", "FOUND"] }, sentToCaptureAt: { not: null } }, select: { id: true, status: true, sentToCaptureAt: true, captureOwnerId: true } });
  const since = new Date(now.getTime() - DAY);
  const fresh = open.filter((r) => r.sentToCaptureAt! >= since).length;
  const free = open.filter((r) => r.status === "SEARCHING" && !r.captureOwnerId).length;
  const late = open.filter((r) => r.status === "SEARCHING" && now.getTime() - r.sentToCaptureAt!.getTime() > 15 * DAY).length;
  let sent = 0;
  for (const u of team) {
    const done = await db.reminderLog.findUnique({ where: { userId_day_kind: { userId: u.id, day, kind: "capture_morning" } } });
    if (done) continue;
    // retorno das indicações dele (últimos 60 dias) que mudou desde o último aviso
    const inds = await db.captureIndication.findMany({ where: { byId: u.id, createdAt: { gte: new Date(now.getTime() - 60 * DAY) } }, select: { id: true, radarId: true, code: true, createdAt: true, lastOutcome: true, radar: { select: { clientId: true, rejectedCodes: true } } } });
    const outs = await outcomesFor(inds.map((i) => ({ radarId: i.radarId, code: i.code, clientId: i.radar.clientId, rejectedCodes: i.radar.rejectedCodes, since: i.createdAt })));
    const changed = inds.filter((i) => outs.get(`${i.radarId}|${i.code}`)!.outcome !== (i.lastOutcome ?? "OFFERED"));
    const parts = [
      fresh ? `${fresh} pedido${fresh > 1 ? "s" : ""} novo${fresh > 1 ? "s" : ""}` : null,
      free ? `${free} sem ninguém buscando` : null,
      late ? `${late} esperando há 15+ dias` : null,
      ...changed.slice(0, 3).map((i) => `${i.code}: ${outcomeText(outs.get(`${i.radarId}|${i.code}`)!).toLowerCase()}`),
    ].filter((x): x is string => !!x);
    await db.$transaction(async (tx) => {
      await tx.reminderLog.create({ data: { userId: u.id, day, kind: "capture_morning", count: parts.length } });
      for (const i of changed) await tx.captureIndication.update({ where: { id: i.id }, data: { lastOutcome: outs.get(`${i.radarId}|${i.code}`)!.outcome } });
    });
    if (!parts.length) continue;
    await sendAlerts([u.id], { title: "Bom dia, captação", body: parts.join(" · "), url: "/demanda/pedidos", tag: `bomdia-${day}` }, { notify: opts.notify, now });
    sent++;
  }
  return sent;
}
