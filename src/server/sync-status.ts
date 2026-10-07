import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export type SyncHealth = { level: "ok" | "stale" | "error" | "off"; message: string; lastSuccessAt: Date | null };

/** Estado resumido da integração para o cabeçalho (sem dados sensíveis). */
export async function syncHealth(now = new Date()): Promise<SyncHealth> {
  try {
    const conn = await db.googleConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } });
    if (!conn || !conn.calendarId) return { level: "off", message: "Agenda Google não configurada", lastSuccessAt: null };
    const state = await db.syncState.findUnique({ where: { calendarId: conn.calendarId } });
    const last = state?.lastSuccessAt ?? null;
    if (conn.status === "NEEDS_RECONNECT") return { level: "error", message: "Agenda desconectada — avise a administração", lastSuccessAt: last };
    const s = await getSettings();
    if (!last) return { level: "stale", message: "Aguardando a primeira sincronização", lastSuccessAt: null };
    const mins = Math.floor((now.getTime() - last.getTime()) / 60_000);
    if (mins > Math.max(3 * s.syncIntervalMinutes, 15)) return { level: "stale", message: `Agenda desatualizada (última atualização há ${fmtAgo(mins)})`, lastSuccessAt: last };
    return { level: "ok", message: `Agenda atualizada há ${fmtAgo(mins)}`, lastSuccessAt: last };
  } catch {
    return { level: "error", message: "Não foi possível verificar a agenda", lastSuccessAt: null };
  }
}

export function fmtAgo(mins: number) {
  if (mins < 1) return "menos de 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} dias`;
}
