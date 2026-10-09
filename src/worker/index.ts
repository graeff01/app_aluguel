/**
 * Worker persistente de sincronização (serviço separado no Railway, mesmo código do app).
 * - Intervalo configurável (AppSettings.syncIntervalMinutes, padrão 5 min), lido a cada ciclo.
 * - Atende solicitações manuais enfileiradas (SyncRun QUEUED).
 * - Bloqueio global por advisory lock: várias réplicas não sincronizam ao mesmo tempo.
 * - Backoff após falhas (SyncState.nextAttemptAt). Encerramento gracioso em SIGTERM.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { log, errorCode } from "@/lib/log";
import { getSettings } from "@/lib/settings";
import { executeRun } from "@/server/sync/runner";
import { sendDailyReminders, sendUpcomingVisitReminders, sendWeeklySummary } from "@/server/reminders";
import { refreshPropertyPreviews } from "@/server/property-preview";
import { recordError } from "@/lib/error-tracking";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 15_000);
const WORKER_ID = process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local";
let stopping = false;
let lastReminderCheck = 0;
let lastUpcomingCheck = 0;
let lastPreviewCheck = 0;

async function heartbeat(startedAt: Date) {
  await db.workerHeartbeat.upsert({
    where: { id: WORKER_ID },
    update: { beatAt: new Date() },
    create: { id: WORKER_ID, beatAt: new Date(), startedAt, version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
  });
}

/** Execuções RUNNING antigas (worker reiniciado no meio) são marcadas como interrompidas. */
async function recoverInterrupted() {
  const stale = new Date(Date.now() - 30 * 60_000);
  const r = await db.syncRun.updateMany({
    where: { status: "RUNNING", startedAt: { lt: stale } },
    data: { status: "FAILED", finishedAt: new Date(), errorCode: "INTERRUPTED", errorMessage: "Execução interrompida (reinício do worker)." },
  });
  if (r.count) log.warn("worker.recovered_interrupted", { count: r.count });
}

export async function tick() {
  const queued = await db.syncRun.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
  if (queued) {
    await executeRun(queued.id);
    return;
  }
  const conn = await db.googleConnection.findFirst({ where: { status: "CONNECTED", calendarId: { not: null } }, orderBy: { connectedAt: "desc" } });
  if (!conn?.calendarId) return;
  const settings = await getSettings();
  const state = await db.syncState.findUnique({ where: { calendarId: conn.calendarId } });
  const now = Date.now();
  const intervalMs = Math.max(1, settings.syncIntervalMinutes) * 60_000;
  if (state?.nextAttemptAt && state.nextAttemptAt.getTime() > now) return;
  if (state?.lastAttemptAt && now - state.lastAttemptAt.getTime() < intervalMs) return;
  const run = await db.syncRun.create({ data: { trigger: "SCHEDULED", status: "QUEUED" } });
  await executeRun(run.id);
}

async function main() {
  const startedAt = new Date();
  log.info("worker.start", { worker: WORKER_ID, tickMs: TICK_MS });
  await recoverInterrupted();
  while (!stopping) {
    try {
      await heartbeat(startedAt);
      await tick();
      if (Date.now() - lastUpcomingCheck > 60_000) {
        lastUpcomingCheck = Date.now();
        await sendUpcomingVisitReminders().catch((e) => log.error("upcoming_reminders.failed", { code: errorCode(e) }));
      }
      if (Date.now() - lastPreviewCheck > 2 * 60_000) {
        lastPreviewCheck = Date.now();
        await refreshPropertyPreviews().catch((e) => log.error("property_preview.failed", { code: errorCode(e) }));
      }
      if (Date.now() - lastReminderCheck > 10 * 60_000) {
        lastReminderCheck = Date.now();
        await sendDailyReminders().catch((e) => log.error("reminders.failed", { code: errorCode(e) }));
        await sendWeeklySummary().catch((e) => log.error("weekly_summary.failed", { code: errorCode(e) }));

      }
    } catch (e) {
      log.error("worker.tick_failed", { code: errorCode(e) });
      await recordError({ source: "worker", message: `${errorCode(e)}: ${(e as Error)?.message ?? ""}`, path: "worker" });
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  await db.$disconnect();
  log.info("worker.stopped");
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    stopping = true;
    log.info("worker.stopping", { signal: sig });
    setTimeout(() => process.exit(0), 25_000).unref();
  });
}

if (process.env.VITEST !== "true") {
  main().catch((e) => {
    log.error("worker.crashed", { code: errorCode(e) });
    process.exit(1);
  });
}
