/**
 * Backup diário do banco: exporta todas as tabelas, compacta (gzip) e CRIPTOGRAFA (AES-256-GCM) antes de enviar
 * a um armazenamento compatível com S3 (Cloudflare R2, AWS S3…). O arquivo não abre sem BACKUP_ENCRYPTION_KEY.
 * Retenção: 30 dias de backups diários + o primeiro de cada mês por 12 meses.
 * Restauração: scripts/restore-backup.ts (mesmo código: restoreInto).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import pg from "pg";
import { AwsClient } from "aws4fetch";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log, errorCode } from "@/lib/log";
import { TZ, dayKey } from "@/lib/time";

const MAGIC = Buffer.from("VLB1");
const FORMAT = "visitas-backup/1";
const PREFIX = "backups/";

export type BackupConfig = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string; key: Buffer };

export function backupConfig(): BackupConfig | null {
  const e = process.env;
  const raw = e.BACKUP_ENCRYPTION_KEY ?? "";
  if (!e.BACKUP_S3_ENDPOINT || !e.BACKUP_S3_BUCKET || !e.BACKUP_S3_ACCESS_KEY_ID || !e.BACKUP_S3_SECRET_ACCESS_KEY || !raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY deve ter 32 bytes em base64");
  return { endpoint: e.BACKUP_S3_ENDPOINT.replace(/\/$/, ""), bucket: e.BACKUP_S3_BUCKET, accessKeyId: e.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: e.BACKUP_S3_SECRET_ACCESS_KEY, region: e.BACKUP_S3_REGION || "auto", key };
}

// ─────────────── formato ───────────────

export type BackupData = { format: string; createdAt: string; tables: Record<string, Record<string, unknown>[]> };

export function encryptBackup(data: BackupData, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 })), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function decryptBackup(buf: Buffer, key: Buffer): BackupData {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("Arquivo não é um backup do Visitas Locação");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  const data = JSON.parse(gunzipSync(Buffer.concat([d.update(buf.subarray(32)), d.final()])).toString("utf8")) as BackupData;
  if (data.format !== FORMAT) throw new Error(`Formato de backup desconhecido: ${data.format}`);
  return data;
}

/** Datas como texto cru (sem conversão de fuso), para o arquivo voltar idêntico. */
const RAW_TYPES = new Set([1082, 1083, 1114, 1184]);
function rawClient(connectionString: string) {
  return new pg.Client({
    connectionString,
    types: { getTypeParser: ((oid: number, format?: "text" | "binary") => (RAW_TYPES.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format as "text"))) as typeof pg.types.getTypeParser },
  });
}

async function publicTables(c: pg.Client) {
  return (await c.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).rows.map((r) => r.tablename);
}

export async function exportDatabase(connectionString = env.databaseUrl): Promise<{ data: BackupData; rows: number }> {
  const c = rawClient(connectionString);
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); // fotografia consistente
    const tables: BackupData["tables"] = {};
    let rows = 0;
    for (const t of await publicTables(c)) {
      const r = await c.query(`SELECT * FROM "${t}"`);
      tables[t] = r.rows;
      rows += r.rowCount ?? 0;
    }
    await c.query("COMMIT");
    return { data: { format: FORMAT, createdAt: new Date().toISOString(), tables }, rows };
  } finally {
    await c.end();
  }
}

/**
 * Restaura num banco JÁ migrado na mesma versão. Recusa banco com dados, a menos que replace=true (apaga tudo antes).
 * Usa json_populate_recordset (tipos, arrays e JSON voltam exatamente) com as chaves estrangeiras adiadas.
 */
export async function restoreInto(connectionString: string, data: BackupData, opts: { replace?: boolean } = {}) {
  const c = rawClient(connectionString);
  await c.connect();
  try {
    const target = await publicTables(c);
    const migrations = (data.tables._prisma_migrations ?? []).map((m) => String(m.migration_name)).sort();
    const have = target.includes("_prisma_migrations") ? (await c.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`)).rows.map((r) => r.migration_name).sort() : [];
    if (JSON.stringify(migrations) !== JSON.stringify(have)) throw new Error("O banco de destino não está na mesma versão do backup. Rode as migrações da mesma versão antes (npx prisma migrate deploy).");
    const tables = Object.keys(data.tables).filter((t) => t !== "_prisma_migrations" && target.includes(t));
    const users = target.includes("User") ? Number((await c.query(`SELECT count(*) FROM "User"`)).rows[0].count) : 0;
    if (users > 0 && !opts.replace) throw new Error("O banco de destino já tem dados. Use a opção de substituir para apagar e restaurar.");
    await c.query("BEGIN");
    await c.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
    // as FKs do Prisma não são adiáveis: com permissão, desliga os gatilhos de FK durante a carga (ordem livre)
    let replica = true;
    await c.query("SAVEPOINT rep");
    try {
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query("RELEASE SAVEPOINT rep");
    } catch {
      await c.query("ROLLBACK TO SAVEPOINT rep");
      replica = false;
    }
    let rows = 0;
    if (replica) {
      for (const t of tables) rows += await insertAll(c, t, data.tables[t]);
    } else {
      // sem permissão de superusuário: insere em rodadas até todas as dependências estarem presentes
      let pending = [...tables];
      for (let round = 0; pending.length && round < tables.length + 1; round++) {
        const next: string[] = [];
        for (const t of pending) {
          await c.query("SAVEPOINT sp");
          try {
            rows += await insertAll(c, t, data.tables[t]);
            await c.query("RELEASE SAVEPOINT sp");
          } catch {
            await c.query("ROLLBACK TO SAVEPOINT sp");
            next.push(t);
          }
        }
        pending = next;
      }
      if (pending.length) throw new Error(`Não foi possível restaurar: ${pending.join(", ")}`);
    }
    await c.query("COMMIT");
    return { tables: tables.length, rows };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

async function insertAll(c: pg.Client, table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += 500) {
    await c.query(`INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json)`, [JSON.stringify(rows.slice(i, i + 500))]);
  }
  return rows.length;
}

// ─────────────── armazenamento (S3/R2) ───────────────

export type Storage = { put(key: string, body: Buffer): Promise<void>; list(prefix: string): Promise<string[]>; remove(key: string): Promise<void>; get(key: string): Promise<Buffer> };

export function s3Storage(cfg: BackupConfig): Storage {
  const aws = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: cfg.region });
  const url = (key = "") => `${cfg.endpoint}/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const ok = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`Armazenamento: ${what} falhou (${res.status})`);
    return res;
  };
  return {
    async put(key, body) {
      await ok(await aws.fetch(url(key), { method: "PUT", body: new Uint8Array(body), headers: { "content-type": "application/octet-stream" } }), "envio");
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | null = null;
      do {
        const q: URLSearchParams = new URLSearchParams({ "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) });
        const xml: string = await (await ok(await aws.fetch(`${url()}?${q}`), "listagem")).text();
        for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, "&"));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? null) : null;
      } while (token);
      return keys;
    },
    async remove(key) {
      await ok(await aws.fetch(url(key), { method: "DELETE" }), "remoção");
    },
    async get(key) {
      return Buffer.from(await (await ok(await aws.fetch(url(key)), "download")).arrayBuffer());
    },
  };
}

// ─────────────── execução e retenção ───────────────

function localStamp(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}-${g("hour")}${g("minute")}`;
}

/** Quais arquivos apagar: mantém 30 dias de diários e o primeiro backup de cada mês por 12 meses. */
export function retentionToDelete(keys: string[], now: Date) {
  const items = keys
    .map((k) => ({ k, m: k.match(/visitas-(\d{4}-\d{2}-\d{2})-\d{4}\.vlb$/) }))
    .filter((x) => x.m)
    .map((x) => ({ k: x.k, day: x.m![1] }))
    .sort((a, b) => a.k.localeCompare(b.k));
  const today = dayKey(now);
  const ageDays = (day: string) => (Date.parse(today) - Date.parse(day)) / 86400_000;
  const firstOfMonth = new Set<string>();
  const seen = new Set<string>();
  for (const it of items) {
    const month = it.day.slice(0, 7);
    if (!seen.has(month)) {
      seen.add(month);
      firstOfMonth.add(it.k);
    }
  }
  return items.filter((it) => !(ageDays(it.day) <= 30 || (firstOfMonth.has(it.k) && ageDays(it.day) <= 366))).map((it) => it.k);
}

export async function runBackup(opts: { trigger: "SCHEDULED" | "MANUAL"; now?: Date; storage?: Storage; config?: BackupConfig | null; databaseUrl?: string } = { trigger: "SCHEDULED" }) {
  const cfg = opts.config !== undefined ? opts.config : backupConfig();
  if (!cfg) return { skipped: "NOT_CONFIGURED" as const };
  const now = opts.now ?? new Date();
  const run = await db.backupRun.create({ data: { status: "RUNNING", trigger: opts.trigger, startedAt: now } });
  try {
    const storage = opts.storage ?? s3Storage(cfg);
    const { data, rows } = await exportDatabase(opts.databaseUrl);
    const body = encryptBackup(data, cfg.key);
    const objectKey = `${PREFIX}visitas-${localStamp(now)}.vlb`;
    await storage.put(objectKey, body);
    await db.backupRun.update({ where: { id: run.id }, data: { status: "SUCCESS", finishedAt: new Date(), objectKey, sizeBytes: body.length, rows } });
    // retenção (falha aqui não invalida o backup feito)
    try {
      for (const k of retentionToDelete(await storage.list(PREFIX), now)) await storage.remove(k);
    } catch (e) {
      log.warn("backup.retention_failed", { code: errorCode(e) });
    }
    log.info("backup.done", { sizeBytes: body.length, rows });
    return { ok: true as const, objectKey, sizeBytes: body.length, rows };
  } catch (e) {
    await db.backupRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), errorCode: errorCode(e).slice(0, 120) } });
    log.error("backup.failed", { code: errorCode(e) });
    return { ok: false as const, error: errorCode(e) };
  }
}

/** Worker: uma vez por dia, a partir das 3h (Brasília); até 3 tentativas no dia, com 2 h de intervalo. */
export async function maybeDailyBackup(now = new Date(), opts: { storage?: Storage; config?: BackupConfig | null } = {}) {
  const cfg = opts.config !== undefined ? opts.config : backupConfig();
  if (!cfg) return { skipped: "NOT_CONFIGURED" as const };
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < 3) return { skipped: "NOT_TIME" as const };
  const since = new Date(now.getTime() - 24 * 3600_000);
  const recent = await db.backupRun.findMany({ where: { startedAt: { gte: since } }, orderBy: { startedAt: "desc" } });
  const today = dayKey(now);
  const todays = recent.filter((r) => dayKey(r.startedAt) === today);
  if (todays.some((r) => r.status === "SUCCESS" || (r.status === "RUNNING" && now.getTime() - r.startedAt.getTime() < 3600_000))) return { skipped: "DONE_TODAY" as const };
  const failed = todays.filter((r) => r.status === "FAILED");
  if (failed.length >= 3 || (failed[0] && now.getTime() - failed[0].startedAt.getTime() < 2 * 3600_000)) return { skipped: "WAITING_RETRY" as const };
  const r = await runBackup({ trigger: "SCHEDULED", now, storage: opts.storage, config: cfg });
  if ("ok" in r && !r.ok && failed.length === 2) await notifyBackupFailure(now);
  return r;
}

async function notifyBackupFailure(now: Date) {
  const { sendPush } = await import("@/lib/push");
  const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, include: { pushSubscriptions: true } });
  for (const a of admins) {
    for (const s of a.pushSubscriptions) {
      await sendPush(s, { title: "Backup do banco falhou", body: "Três tentativas sem sucesso hoje. Veja o Diagnóstico.", url: "/admin/sincronizacao", tag: `backup-${dayKey(now)}` }).catch(() => undefined);
    }
  }
}
