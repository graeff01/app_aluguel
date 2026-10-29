/**
 * Avisos que ficam no app até a pessoa abrir (a notificação do celular some ou nem chega se a pessoa não ativou):
 * troca entre a captação e quem atende o cliente. Cada aviso também vai como notificação no celular.
 * Só perfil do imóvel e o que aconteceu: nenhum dado do cliente.
 */
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import type { AuthzActor } from "@/lib/authz";
import { notifyUser } from "./notify";

export type AlertPayload = { title: string; body: string; url: string; tag: string };
type Notify = (userId: string, p: AlertPayload) => Promise<unknown>;

const DAY = 86400_000;
/** Avisos lidos somem depois disto. */
export const ALERT_KEEP_DAYS = 60;

/**
 * Grava o aviso para cada pessoa (ativa, menos quem fez a ação) e manda a notificação no celular. Mesmo assunto
 * (tag) ainda não lido: atualiza o aviso existente em vez de empilhar.
 */
export async function sendAlerts(userIds: (string | null | undefined)[], p: AlertPayload, opts: { exclude?: string; notify?: Notify; now?: Date } = {}) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== opts.exclude))];
  if (!ids.length) return 0;
  const active = (await db.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } })).map((u) => u.id);
  const now = opts.now ?? new Date();
  const notify = opts.notify ?? notifyUser;
  for (const userId of active) {
    const open = await db.alert.findFirst({ where: { userId, tag: p.tag, readAt: null }, select: { id: true } });
    if (open) await db.alert.update({ where: { id: open.id }, data: { title: p.title, body: p.body, url: p.url, createdAt: now } });
    else await db.alert.create({ data: { userId, ...p, createdAt: now } });
    await notify(userId, p).catch(() => undefined);
  }
  return active.length;
}

/** Ids das pessoas ativas de um perfil. */
export const usersWithRole = async (role: "CAPTURE" | "PRE_SERVICE") => (await db.user.findMany({ where: { role, active: true }, select: { id: true } })).map((u) => u.id);

export const countUnreadAlerts = (actor: AuthzActor) => db.alert.count({ where: { userId: actor.id, readAt: null } });

export async function listAlerts(actor: AuthzActor) {
  return db.alert.findMany({ where: { userId: actor.id }, orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 100 });
}

/** O aviso mais recente ainda não lido (faixa no topo do app). */
export const latestUnreadAlert = (actor: AuthzActor) => db.alert.findFirst({ where: { userId: actor.id, readAt: null }, orderBy: { createdAt: "desc" } });

/** Abre o aviso: marca como lido e devolve para onde ir. */
export async function openAlert(actor: AuthzActor, id: string, now = new Date()) {
  const a = await db.alert.findUnique({ where: { id } });
  if (!a || a.userId !== actor.id) throw notFound();
  if (!a.readAt) await db.alert.update({ where: { id }, data: { readAt: now } });
  return a.url.startsWith("/") ? a.url : "/avisos";
}

export const markAllAlertsRead = (actor: AuthzActor, now = new Date()) => db.alert.updateMany({ where: { userId: actor.id, readAt: null }, data: { readAt: now } });

/** Limpeza: avisos lidos há mais de ALERT_KEEP_DAYS. */
export const runAlertRetention = (now = new Date()) => db.alert.deleteMany({ where: { readAt: { lt: new Date(now.getTime() - ALERT_KEEP_DAYS * DAY) } } });
