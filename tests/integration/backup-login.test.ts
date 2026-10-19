// Backup (ida e volta, retenção, agendamento), "Entrar com Google" e alerta de agenda parada.
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createManualVisit } from "@/server/visits";
import { decryptBackup, encryptBackup, exportDatabase, maybeDailyBackup, restoreInto, retentionToDelete, runBackup, type BackupConfig, type Storage } from "@/server/backup";
import { resolveGoogleUser } from "@/server/google-login";
import { sendGoogleExpiryAlerts, sendSyncAlerts, type Sender } from "@/server/reminders";
import { googleExpiry } from "@/server/google-expiry";
import { toLocalInput } from "@/lib/time";
import { makeConnection, makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
const KEY = randomBytes(32);
const cfg: BackupConfig = { endpoint: "https://s3.test", bucket: "b", accessKeyId: "x", secretAccessKey: "y", region: "auto", key: KEY };
function memStorage() {
  const files = new Map<string, Buffer>();
  const s: Storage = {
    async put(k, b) { files.set(k, b); },
    async list(p) { return [...files.keys()].filter((k) => k.startsWith(p)); },
    async remove(k) { files.delete(k); },
    async get(k) { return files.get(k)!; },
  };
  return { s, files };
}

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

describe("backup", () => {
  it("exporta, criptografa e restaura tudo exatamente (datas, listas e JSON)", async () => {
    const v = await createManualVisit(u.admin, { requestId: "bk-visit-req", scheduledStart: toLocalInput(new Date("2026-10-09T17:00:00Z")), clientName: "Cliente Backup", phoneRaw: "(51) 99876-4444", propertyCode: "761739", consultantId: u.a.id });
    await db.visit.update({ where: { id: v.id }, data: { manualFields: ["clientName", "phone"], conflictDetail: { google: { clientName: "Outro" } } } });
    await db.property.update({ where: { code: "761739" }, data: { photos: ["https://img.test/1.jpg"], lat: -29.91 } });
    const before = { visit: await db.visit.findUniqueOrThrow({ where: { id: v.id } }), users: await db.user.count(), aliases: await db.userEmailAlias.count() };

    const { data, rows } = await exportDatabase(env.databaseUrl);
    expect(rows).toBeGreaterThan(10);
    const file = encryptBackup(data, KEY);
    expect(file.includes(Buffer.from("Cliente Backup"))).toBe(false); // nada legível no arquivo
    expect(() => decryptBackup(file, randomBytes(32))).toThrow(); // chave errada não abre

    await expect(restoreInto(env.databaseUrl, decryptBackup(file, KEY))).rejects.toThrow(/já tem dados/);
    await db.visit.deleteMany();
    await db.user.updateMany({ data: { name: "Alterado" } });
    const r = await restoreInto(env.databaseUrl, decryptBackup(file, KEY), { replace: true });
    expect(r.rows).toBeGreaterThan(10);
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    expect(after).toEqual(before.visit);
    expect(await db.user.count()).toBe(before.users);
    expect(await db.userEmailAlias.count()).toBe(before.aliases);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.a.id } })).name).toBe("Consultora A");
    expect((await db.property.findUniqueOrThrow({ where: { code: "761739" } })).photos).toEqual(["https://img.test/1.jpg"]);
  });

  it("recusa banco de destino em outra versão", async () => {
    const { data } = await exportDatabase(env.databaseUrl);
    data.tables._prisma_migrations = [...data.tables._prisma_migrations, { migration_name: "29990101000000_futura" }];
    await expect(restoreInto(env.databaseUrl, data, { replace: true })).rejects.toThrow(/mesma versão/);
  });

  it("retenção: 30 dias de diários + primeiro de cada mês por 12 meses", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const k = (d: string) => `backups/visitas-${d}-0300.vlb`;
    const keys = [k("2025-09-01"), k("2025-11-01"), k("2025-11-02"), k("2026-08-01"), k("2026-08-15"), k("2026-09-09"), k("2026-09-12"), k("2026-10-09"), "backups/outra-coisa.txt"];
    // 09/09 é o primeiro de setembro (mensal, fica); 12/09 está dentro dos 30 dias
    expect(retentionToDelete(keys, now).sort()).toEqual([k("2025-09-01"), k("2025-11-02"), k("2026-08-15")].sort());
  });

  it("execução: envia o arquivo, registra e não repete no mesmo dia; antes das 3h espera", async () => {
    const { s, files } = memStorage();
    expect(await maybeDailyBackup(new Date("2026-10-10T04:00:00Z"), { storage: s, config: cfg })).toEqual({ skipped: "NOT_TIME" }); // 01:00 em SP
    const r = await maybeDailyBackup(new Date("2026-10-10T07:00:00Z"), { storage: s, config: cfg }); // 04:00
    expect(r).toMatchObject({ ok: true, objectKey: "backups/visitas-2026-10-10-0400.vlb" });
    expect(files.size).toBe(1);
    expect(decryptBackup(files.get("backups/visitas-2026-10-10-0400.vlb")!, KEY).tables.User.length).toBe(4);
    expect(await maybeDailyBackup(new Date("2026-10-10T09:00:00Z"), { storage: s, config: cfg })).toEqual({ skipped: "DONE_TODAY" });
    expect(await db.backupRun.findFirst()).toMatchObject({ status: "SUCCESS", trigger: "SCHEDULED" });
    expect(await runBackup({ trigger: "MANUAL", config: null })).toEqual({ skipped: "NOT_CONFIGURED" });
  });

  it("falha no envio fica registrada e tenta de novo depois de 2 h", async () => {
    const broken: Storage = { put: async () => { throw new Error("rede"); }, list: async () => [], remove: async () => {}, get: async () => Buffer.alloc(0) };
    expect(await maybeDailyBackup(new Date("2026-10-10T07:00:00Z"), { storage: broken, config: cfg })).toMatchObject({ ok: false });
    expect(await maybeDailyBackup(new Date("2026-10-10T08:00:00Z"), { storage: broken, config: cfg })).toEqual({ skipped: "WAITING_RETRY" });
    expect(await db.backupRun.findFirst()).toMatchObject({ status: "FAILED" });
  });
});

describe("entrar com Google", () => {
  it("só entra quem tem cadastro ativo (e-mail principal ou da agenda) e vincula a conta Google", async () => {
    expect(await resolveGoogleUser({ sub: "g1", email: "ninguem@exemplo.test", emailVerified: true })).toEqual({ error: "sem_cadastro" });
    expect(await resolveGoogleUser({ sub: "g1", email: "a@exemplo.test", emailVerified: false })).toEqual({ error: "nao_verificado" });
    const viaAlias = await resolveGoogleUser({ sub: "g-a", email: "Consultora.A@exemplo.test", emailVerified: true });
    expect("user" in viaAlias ? viaAlias.user?.id : null).toBe(u.a.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.a.id } })).googleSub).toBe("g-a");
    // outra conta Google com o mesmo e-mail é recusada depois do vínculo
    expect(await resolveGoogleUser({ sub: "g-intruso", email: "a@exemplo.test", emailVerified: true })).toEqual({ error: "conta_diferente" });
    await db.user.update({ where: { id: u.b.id }, data: { active: false } });
    expect(await resolveGoogleUser({ sub: "g-b", email: "b@exemplo.test", emailVerified: true })).toEqual({ error: "inativo" });
  });

  it("senha provisória deixa de valer ao entrar com Google", async () => {
    await db.user.update({ where: { id: u.manager.id }, data: { passwordHash: "hash-provisorio", mustChangePassword: true } });
    await resolveGoogleUser({ sub: "g-m", email: "gestora@exemplo.test", emailVerified: true });
    expect(await db.user.findUniqueOrThrow({ where: { id: u.manager.id } })).toMatchObject({ passwordHash: null, mustChangePassword: false, googleSub: "g-m" });
    expect(await db.auditLog.count({ where: { action: "auth.google_login" } })).toBe(1);
  });
});

describe("alerta de agenda parada", () => {
  it("avisa admin e gestão uma vez por dia e avisa quando normaliza", async () => {
    const conn = await makeConnection();
    await db.googleConnection.update({ where: { id: conn.id }, data: { status: "NEEDS_RECONNECT" } });
    await db.pushSubscription.createMany({ data: [
      { userId: u.admin.id, endpoint: "https://push.test/admin", p256dh: "k", auth: "a" },
      { userId: u.manager.id, endpoint: "https://push.test/m", p256dh: "k", auth: "a" },
      { userId: u.a.id, endpoint: "https://push.test/a", p256dh: "k", auth: "a" },
    ] });
    const sent: { endpoint: string; title: string; url: string }[] = [];
    const send: Sender = async (t, p) => (sent.push({ endpoint: t.endpoint, title: p.title, url: p.url }), "ok");
    const now = new Date("2026-10-10T15:00:00Z");
    await sendSyncAlerts(now, { send, email: null });
    await sendSyncAlerts(new Date(now.getTime() + 60_000), { send, email: null });
    expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push.test/admin", "https://push.test/m"]);
    expect(sent.find((s) => s.endpoint.endsWith("admin"))).toMatchObject({ title: "Agenda Google parada", url: "/admin/google" });

    await db.googleConnection.update({ where: { id: conn.id }, data: { status: "CONNECTED" } });
    await db.syncState.create({ data: { calendarId: conn.calendarId!, lastSuccessAt: new Date(now.getTime() + 100_000) } });
    await sendSyncAlerts(new Date(now.getTime() + 120_000), { send, email: null });
    expect(sent.filter((s) => s.title === "Agenda Google normalizada")).toHaveLength(2);
  });
});

describe("aviso antes de a conexão Google vencer (modo teste)", () => {
  it("avisa o admin 1 dia antes e 3 h antes, uma vez cada; reconectar zera; app publicado não avisa", async () => {
    const connectedAt = new Date("2026-10-12T22:00:00Z");
    const conn = await makeConnection();
    await db.googleConnection.update({ where: { id: conn.id }, data: { connectedAt } });
    await db.pushSubscription.createMany({ data: [
      { userId: u.admin.id, endpoint: "https://push.test/admin", p256dh: "k", auth: "a" },
      { userId: u.manager.id, endpoint: "https://push.test/m", p256dh: "k", auth: "a" },
    ] });
    const sent: { endpoint: string; title: string; url: string; body: string }[] = [];
    const send: Sender = async (t, p) => (sent.push({ endpoint: t.endpoint, title: p.title, url: p.url, body: p.body }), "ok");
    const at = (h: number) => new Date(connectedAt.getTime() + h * 3600_000);
    // vence em 7 dias (19/10 22:00 UTC = 19h em Brasília)
    expect((await googleExpiry(at(0)))?.expiresAt.toISOString()).toBe("2026-10-19T22:00:00.000Z");
    expect((await googleExpiry(at(100)))?.level).toBe("ok");
    await sendGoogleExpiryAlerts(at(100), { send, email: null });
    expect(sent).toHaveLength(0);
    // faltando 20 h: avisa só o admin, uma vez
    expect((await googleExpiry(at(148)))?.level).toBe("soon");
    await sendGoogleExpiryAlerts(at(148), { send, email: null });
    await sendGoogleExpiryAlerts(at(149), { send, email: null });
    expect(sent.map((s) => s.endpoint)).toEqual(["https://push.test/admin"]);
    expect(sent[0]).toMatchObject({ title: "Agenda Google expira amanhã", url: "/admin/google" });
    expect(sent[0].body).toContain("19:00");
    // faltando 2 h: segundo aviso
    await sendGoogleExpiryAlerts(at(166), { send, email: null });
    await sendGoogleExpiryAlerts(at(166.5), { send, email: null });
    expect(sent.map((s) => s.title)).toEqual(["Agenda Google expira amanhã", "Agenda Google expira em poucas horas"]);
    expect((await googleExpiry(at(169)))?.level).toBe("expired");
    // reconectou: nova conexão, mais 7 dias
    await db.googleConnection.update({ where: { id: conn.id }, data: { status: "DISCONNECTED" } });
    await db.googleConnection.update({ where: { id: (await makeConnection()).id }, data: { connectedAt: at(150) } });
    expect((await googleExpiry(at(151)))?.level).toBe("ok");
    // app publicado no Google: não expira, não avisa
    await db.appSettings.update({ where: { id: 1 }, data: { googleTestingMode: false } });
    expect(await googleExpiry(at(300))).toBeNull();
    await sendGoogleExpiryAlerts(at(300), { send, email: null });
    expect(sent).toHaveLength(2);
  });
});
