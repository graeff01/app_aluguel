/**
 * Fila do que não chegou à agenda Google (conexão expirada, sem permissão, Google fora do ar): o app anota na visita
 * principal o que ficou para trás e, quando a agenda volta, reenvia sozinho a partir do que está no app
 * (cria o evento que faltou, atualiza título/imóveis, horário e consultora, ou leva para as 22h o que foi cancelado).
 * Roda ANTES da leitura da agenda: senão a sincronização desfaria o que ficou para trás (ex.: visita reaberta voltaria
 * a ser cancelada por ainda estar às 22h no Google).
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import type { CalendarApi } from "./sync/types";
import { canEditEvents } from "./sync/google";

export type PendingKind = "create" | "title" | "time" | "consultant" | "cancel";

/** Anota o que ficou para mandar ao Google (na visita principal do grupo: é ela que tem o evento). */
export async function markGooglePending(visitId: string, kinds: PendingKind[], now = new Date()) {
  if (!kinds.length) return;
  const v = await db.visit.findUnique({ where: { id: visitId }, select: { id: true, companionOfId: true } });
  if (!v) return;
  const primaryId = v.companionOfId ?? v.id;
  const p = await db.visit.findUnique({ where: { id: primaryId }, select: { googlePending: true, googlePendingAt: true } });
  if (!p) return;
  await db.visit.update({ where: { id: primaryId }, data: { googlePending: [...new Set([...p.googlePending, ...kinds])], googlePendingAt: p.googlePendingAt ?? now } });
}

/** Tira um tipo da fila (ex.: edição de horário desfeita no app porque o Google não recebeu). */
export async function unmarkGooglePending(visitId: string, kind: PendingKind) {
  const v = await db.visit.findUnique({ where: { id: visitId }, select: { id: true, companionOfId: true } });
  if (!v) return;
  const p = await db.visit.findUnique({ where: { id: v.companionOfId ?? v.id }, select: { id: true, googlePending: true } });
  if (!p?.googlePending.includes(kind)) return;
  const rest = p.googlePending.filter((k) => k !== kind);
  await db.visit.update({ where: { id: p.id }, data: { googlePending: rest, ...(rest.length ? {} : { googlePendingAt: null }) } });
}

const clear = (id: string) => db.visit.update({ where: { id }, data: { googlePending: [], googlePendingAt: null } });

/**
 * Reenvia o que ficou para trás (rodado pelo worker e logo ao reconectar). Só com a agenda conectada e com permissão
 * de edição; o que falhar de novo continua na fila. Devolve quantas visitas foram resolvidas.
 */
export async function flushGooglePending(opts: { calendarApi?: CalendarApi; limit?: number } = {}) {
  const conn = await db.googleConnection.findFirst({ where: { status: "CONNECTED" }, orderBy: { connectedAt: "desc" } });
  if (!conn?.calendarId || (!opts.calendarApi && !canEditEvents(conn.scopes))) return 0;
  const rows = await db.visit.findMany({
    where: { googlePendingAt: { not: null } },
    orderBy: { googlePendingAt: "asc" },
    take: opts.limit ?? 30,
    include: { companions: { where: { excluded: false }, orderBy: { createdAt: "asc" } }, sourceEvent: { select: { calendarId: true, googleEventId: true } } },
  });
  // imports tardios: estes módulos também usam markGooglePending
  const { pushVisitChange } = await import("./google-write");
  const { createVisitEventCore } = await import("./reschedule");
  const { moveGroupToNight } = await import("./visits");
  let done = 0;
  for (const p of rows) {
    const kinds = new Set(p.googlePending);
    const group = [p, ...p.companions].filter((v) => !v.excluded);
    const open = group.filter((v) => v.status === "SCHEDULED");
    let result: string;
    if (!p.sourceEventId) {
      // evento que não chegou a ser criado (ou visita sem agenda): cria se ainda há visita em aberto
      result = kinds.has("create") && open.length && !p.googleCreatedAt ? await createVisitEventCore(p.id, { calendarApi: opts.calendarApi }) : "nothing";
    } else if (open.length) {
      result = await pushVisitChange(open[0].id, { title: true, time: kinds.has("time"), ...(kinds.has("consultant") && open[0].consultantId ? { consultant: { from: null, to: open[0].consultantId, removeOthers: true } } : {}) }, opts.calendarApi, { queue: false });
    } else if (kinds.has("cancel") && group.every((v) => v.status !== "SCHEDULED") && p.sourceEvent) {
      result = await moveGroupToNight(p.sourceEvent, { start: p.scheduledStart, end: p.scheduledEnd }, opts.calendarApi);
    } else result = "nothing";
    if (result === "error" || result === "no_permission") continue; // ainda fora: tenta na próxima rodada
    await clear(p.id);
    await db.$transaction((tx) => audit(tx, { actorId: null, action: "google.pending_flushed", entityType: "Visit", entityId: p.id, changes: { pendente: [...kinds], resultado: result } }));
    done++;
  }
  if (done) log.info("google.pending_flushed", { visitas: done });
  return done;
}

/** Quantas visitas esperam reenvio à agenda (aviso para a gestão). */
export const countGooglePending = () => db.visit.count({ where: { googlePendingAt: { not: null } } });
