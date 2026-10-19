/**
 * App do Google em "modo teste": a autorização vale 7 dias a partir da conexão.
 * Reconectar (mesma conta) renova por mais 7 dias. Calcula quando vence para avisar o admin antes.
 */
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export const GOOGLE_TESTING_DAYS = 7;

export type GoogleExpiry = { connectionId: string; expiresAt: Date; hoursLeft: number; level: "ok" | "soon" | "urgent" | "expired" };

/** null: sem conexão ou app publicado (não expira). "soon" = menos de 24 h; "urgent" = menos de 3 h. */
export async function googleExpiry(now = new Date()): Promise<GoogleExpiry | null> {
  const settings = await getSettings();
  if (!settings.googleTestingMode) return null;
  const conn = await db.googleConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" }, select: { id: true, connectedAt: true } });
  if (!conn) return null;
  const expiresAt = new Date(conn.connectedAt.getTime() + GOOGLE_TESTING_DAYS * 86400_000);
  const hoursLeft = (expiresAt.getTime() - now.getTime()) / 3600_000;
  const level = hoursLeft <= 0 ? "expired" : hoursLeft <= 3 ? "urgent" : hoursLeft <= 24 ? "soon" : "ok";
  return { connectionId: conn.id, expiresAt, hoursLeft, level };
}
