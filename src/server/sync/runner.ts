/**
 * Execução de sincronização com bloqueio global (advisory lock do Postgres em conexão dedicada),
 * registro em SyncRun e backoff entre execuções com falha.
 */
import pg from "pg";
import { db } from "@/lib/db";
import { errorCode, log } from "@/lib/log";
import { getSettings } from "@/lib/settings";
import { runSync, type SyncStats } from "./engine";
import { authorizedClient, realCalendarApi } from "./google";
import { GoogleApiError, type CalendarApi } from "./types";
import { refreshPropertyPreviews } from "../property-preview";

export const SYNC_LOCK_KEY = 74_210_626;

/** Tenta obter o bloqueio; se outra instância estiver sincronizando, retorna null sem executar. */
export async function withSyncLock<T>(fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [SYNC_LOCK_KEY]);
    if (!r.rows[0]?.locked) return { ran: false };
    try {
      return { ran: true, value: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SYNC_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

export type ApiFactory = (connectionId: string) => Promise<CalendarApi>;

export const defaultApiFactory: ApiFactory = async (connectionId) => realCalendarApi(await authorizedClient(connectionId));

const MAX_BACKOFF_MS = 60 * 60_000;

/** Executa um SyncRun (já criado como QUEUED) de ponta a ponta. */
export async function executeRun(runId: string, apiFactory: ApiFactory = defaultApiFactory, opts: { full?: boolean; now?: Date } = {}) {
  const result = await withSyncLock(async () => {
    await db.syncRun.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date() } });
    const conn = await db.googleConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } });
    try {
      if (!conn) throw Object.assign(new Error("not connected"), { code: "NOT_CONNECTED" });
      const api = await apiFactory(conn.id);
      const stats: SyncStats = await runSync({ api, full: opts.full, now: opts.now });
      await db.syncRun.update({ where: { id: runId }, data: { status: "SUCCESS", finishedAt: new Date(), stats, mode: stats.mode } });
      log.info("sync.success", { runId, mode: stats.mode, received: stats.received, created: stats.created, updated: stats.updated, conflicts: stats.conflicts });
      // visita nova: busca a foto do imóvel na hora (não espera o ciclo periódico)
      if (stats.created > 0 || stats.updated > 0) await refreshPropertyPreviews({ limit: 10, pauseMs: 300 }).catch(() => undefined);
      return stats;
    } catch (e) {
      const code = errorCode(e);
      const notConfigured = ["NOT_CONNECTED", "NO_CALENDAR"].includes(code);
      if (e instanceof GoogleApiError && e.kind === "AUTH" && conn) {
        await db.googleConnection.update({ where: { id: conn.id }, data: { status: "NEEDS_RECONNECT", statusDetail: "Autorização expirada ou revogada. Reconecte a conta Google." } });
      }
      if (e instanceof GoogleApiError && e.kind === "PERMISSION" && conn) {
        await db.googleConnection.update({ where: { id: conn.id }, data: { statusDetail: "A conta conectada perdeu permissão de leitura dos eventos do calendário selecionado." } });
      }
      if (conn?.calendarId && !notConfigured) {
        const state = await db.syncState.findUnique({ where: { calendarId: conn.calendarId } });
        const failures = (state?.consecutiveFailures ?? 0) + 1;
        const settings = await getSettings();
        const delay = Math.min(settings.syncIntervalMinutes * 60_000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
        await db.syncState.upsert({
          where: { calendarId: conn.calendarId },
          update: { consecutiveFailures: failures, nextAttemptAt: new Date(Date.now() + delay), lastErrorCode: code },
          create: { calendarId: conn.calendarId, consecutiveFailures: failures, nextAttemptAt: new Date(Date.now() + delay), lastErrorCode: code },
        });
      }
      await db.syncRun.update({
        where: { id: runId },
        data: { status: notConfigured ? "SKIPPED" : "FAILED", finishedAt: new Date(), errorCode: code, errorMessage: describeError(code) },
      });
      log.warn("sync.failed", { runId, code });
      return null;
    }
  });
  if (!result.ran) {
    await db.syncRun.update({ where: { id: runId }, data: { status: "SKIPPED", finishedAt: new Date(), errorCode: "LOCKED", errorMessage: describeError("LOCKED") } });
  }
  return result;
}

export function describeError(code: string): string {
  const map: Record<string, string> = {
    NOT_CONNECTED: "Nenhuma conta Google conectada.",
    NO_CALENDAR: "Nenhum calendário selecionado.",
    NEEDS_RECONNECT: "A autorização do Google expirou ou foi revogada. Reconecte a conta.",
    FREEBUSY_ONLY: "A conta conectada só vê ocupado/livre neste calendário. É preciso permissão para ver detalhes dos eventos.",
    GOOGLE_AUTH: "A autorização do Google expirou ou foi revogada. Reconecte a conta.",
    GOOGLE_PERMISSION: "Sem permissão para ler os eventos do calendário selecionado.",
    GOOGLE_RETRYABLE: "Falha temporária ou limite da API do Google. Nova tentativa automática com espera.",
    GOOGLE_NOT_FOUND: "Calendário não encontrado. Verifique a seleção.",
    LOCKED: "Outra sincronização já estava em andamento.",
    INTERRUPTED: "Execução interrompida (reinício do worker).",
  };
  return map[code] ?? "Erro inesperado na sincronização. Veja os logs do worker pelo código.";
}

/** Solicitação manual (botão), com limite de frequência. Retorna a execução criada ou a já pendente. */
export async function requestManualSync(userId: string) {
  const settings = await getSettings();
  const pending = await db.syncRun.findFirst({ where: { status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" } });
  if (pending) return { run: pending, created: false as const };
  const lastManual = await db.syncRun.findFirst({ where: { trigger: "MANUAL" }, orderBy: { createdAt: "desc" } });
  if (lastManual && Date.now() - lastManual.createdAt.getTime() < settings.manualSyncMinSeconds * 1000) {
    const wait = Math.ceil((settings.manualSyncMinSeconds * 1000 - (Date.now() - lastManual.createdAt.getTime())) / 1000);
    return { run: lastManual, created: false as const, retryAfterSeconds: wait };
  }
  const run = await db.syncRun.create({ data: { trigger: "MANUAL", status: "QUEUED", requestedById: userId } });
  return { run, created: true as const };
}
