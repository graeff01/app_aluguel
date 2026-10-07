// Integração do motor de sincronização com Postgres real e API Google MOCK (tests/helpers/mock-calendar.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runSync } from "@/server/sync/engine";
import { executeRun, withSyncLock } from "@/server/sync/runner";
import { concludeVisit } from "@/server/visits";
import { assignVisit } from "@/server/visits";
import { GoogleApiError } from "@/server/sync/types";
import { acceptAmbiguous, rejectAmbiguous } from "@/server/review";
import { MockCalendar, visitEvent } from "../helpers/mock-calendar";
import { makeConnection, makeUsers, resetDb } from "../helpers/db";

const NOW = new Date("2026-10-06T15:00:00Z");
const noSleep = async () => {};
let users: Awaited<ReturnType<typeof makeUsers>>;
let api: MockCalendar;

const sync = (opts: { now?: Date; full?: boolean } = {}) => runSync({ api, now: opts.now ?? NOW, full: opts.full, sleep: noSleep });

beforeEach(async () => {
  await resetDb();
  users = await makeUsers();
  await makeConnection();
  api = new MockCalendar();
});

describe("importação e classificação", () => {
  it("importa visita padrão, atribui pela consultora convidada e não guarda eventos irrelevantes (critérios 1 e 4)", async () => {
    api.put(visitEvent("ev1", { start: "2026-10-06T13:00:00Z", attendees: ["consultora.a@exemplo.test", "gestora@exemplo.test"] }));
    api.put({ id: "lunch", summary: "Almoço", start: { dateTime: "2026-10-06T15:00:00Z" }, end: { dateTime: "2026-10-06T16:00:00Z" } });
    api.put({ id: "tech", summary: "Visita técnica - apto 302", start: { dateTime: "2026-10-06T17:00:00Z" }, end: { dateTime: "2026-10-06T18:00:00Z" } });
    api.put({ id: "meet", summary: "Reunião de equipe", start: { dateTime: "2026-10-07T12:00:00Z" }, end: { dateTime: "2026-10-07T13:00:00Z" } });

    const stats = await sync();
    expect(stats.mode).toBe("full");
    expect(stats.pages).toBeGreaterThan(1); // paginação exercitada

    const visits = await db.visit.findMany();
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({
      consultantId: users.a.id,
      assignmentStatus: "AUTO",
      clientName: "Cliente Exemplo",
      propertyCode: "654321",
      externalRef: "1234567",
      phoneNormalized: "+5551998765432",
      status: "SCHEDULED",
    });
    // eventos claramente irrelevantes não são persistidos
    expect(await db.sourceEvent.count()).toBe(1);
  });

  it("nenhuma/duas consultoras, dados incompletos e ambíguos vão para revisão sem descarte (critério 3)", async () => {
    api.put(visitEvent("none", { start: "2026-10-06T13:00:00Z", attendees: ["gestora@exemplo.test"] }));
    api.put(visitEvent("two", { start: "2026-10-06T14:00:00Z", attendees: ["consultora.a@exemplo.test", "consultora.b@exemplo.test"] }));
    api.put(visitEvent("hidden", { start: "2026-10-06T15:00:00Z", extra: { attendees: [], attendeesOmitted: true } }));
    api.put(visitEvent("partial", { start: "2026-10-06T16:00:00Z", title: "Visita clt - 99876-5432" }));
    api.put({ id: "amb", summary: "Visita apto centro", start: { dateTime: "2026-10-07T13:00:00Z" }, end: { dateTime: "2026-10-07T14:00:00Z" } });
    await sync();

    const byEvent = async (id: string) => db.visit.findFirst({ where: { sourceEvent: { googleEventId: id } } });
    expect((await byEvent("none"))).toMatchObject({ assignmentStatus: "NEEDS_REVIEW", assignmentNote: "NENHUMA_CONSULTORA", consultantId: null });
    expect((await byEvent("two"))).toMatchObject({ assignmentStatus: "NEEDS_REVIEW", assignmentNote: "MAIS_DE_UMA" });
    expect((await byEvent("hidden"))).toMatchObject({ assignmentStatus: "NEEDS_REVIEW", assignmentNote: "CONVIDADOS_INACESSIVEIS" });
    const partial = await byEvent("partial");
    expect(partial).toMatchObject({ clientName: null, propertyCode: null, phoneRaw: "99876-5432", phoneNormalized: null });
    const amb = await db.sourceEvent.findFirst({ where: { googleEventId: "amb" } });
    expect(amb).toMatchObject({ classification: "AMBIGUOUS", reviewDecision: null });
    expect(await db.visit.count()).toBe(4);
  });
});

describe("revisão de eventos ambíguos", () => {
  it("aceito vira visita; rejeitado fica sem conteúdo mesmo após novas sincronizações", async () => {
    api.put({ id: "amb1", summary: "Visita apto - Fulana - cod 321 - (51) 99876-1111", start: { dateTime: "2026-10-07T13:00:00Z" }, end: { dateTime: "2026-10-07T14:00:00Z" }, attendees: [{ email: "consultora.a@exemplo.test" }] });
    api.put({ id: "amb2", summary: "Visita ao dentista", start: { dateTime: "2026-10-07T15:00:00Z" }, end: { dateTime: "2026-10-07T16:00:00Z" } });
    await sync();
    const [e1, e2] = await Promise.all([db.sourceEvent.findFirstOrThrow({ where: { googleEventId: "amb1" } }), db.sourceEvent.findFirstOrThrow({ where: { googleEventId: "amb2" } })]);
    await expect(acceptAmbiguous(users.a, e1.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await acceptAmbiguous(users.manager, e1.id);
    await rejectAmbiguous(users.manager, e2.id);
    const v = await db.visit.findFirstOrThrow({ where: { sourceEventId: e1.id } });
    expect(v).toMatchObject({ consultantId: users.a.id, propertyCode: "321", clientName: "Fulana" });
    api.put({ id: "amb2", summary: "Visita ao dentista (alterado)", start: { dateTime: "2026-10-07T15:00:00Z" }, end: { dateTime: "2026-10-07T16:00:00Z" } });
    await sync({ now: new Date(NOW.getTime() + 60_000) });
    const after = await db.sourceEvent.findUniqueOrThrow({ where: { id: e2.id } });
    expect(after).toMatchObject({ title: null, description: null, reviewDecision: "REJECTED" });
    expect(await db.visit.count()).toBe(1);
  });
});

describe("idempotência e incremental (critério 5)", () => {
  it("sync repetido não duplica visitas; incremental usa syncToken sem timeMin/timeMax", async () => {
    for (let i = 0; i < 5; i++) api.put(visitEvent(`e${i}`, { start: `2026-10-0${6 + (i % 3)}T1${i}:00:00Z` }));
    await sync();
    await sync({ now: new Date(NOW.getTime() + 5 * 60_000) });
    await sync({ now: new Date(NOW.getTime() + 10 * 60_000) });
    expect(await db.visit.count()).toBe(5);
    const incremental = api.calls.filter((c) => c.syncToken);
    expect(incremental.length).toBeGreaterThan(0);
    expect(incremental.every((c) => !c.timeMin && !c.timeMax)).toBe(true);
  });

  it("mudança de horário atualiza a mesma visita e registra histórico; atribuição manual não é sobrescrita", async () => {
    api.put(visitEvent("ev1", { start: "2026-10-08T13:00:00Z" }));
    await sync();
    const v = await db.visit.findFirstOrThrow();
    await assignVisit(users.manager, v.id, users.b.id, "troca combinada");
    api.put(visitEvent("ev1", { start: "2026-10-09T17:00:00Z" }));
    await sync({ now: new Date(NOW.getTime() + 60_000) });
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    expect(after.scheduledStart.toISOString()).toBe("2026-10-09T17:00:00.000Z");
    expect(after.consultantId).toBe(users.b.id);
    expect(await db.visit.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: "sync.visit_updated", entityId: v.id } })).toBe(1);
  });

  it("recorrência: cada ocorrência vira visita própria (não colapsa por iCalUID); ocorrência movida mantém vínculo", async () => {
    const base = { recurringEventId: "serie", iCalUID: "serie@google.com" };
    api.put(visitEvent("serie_20261007T130000Z", { start: "2026-10-07T13:00:00Z", extra: { ...base, originalStartTime: { dateTime: "2026-10-07T13:00:00Z" } } }));
    api.put(visitEvent("serie_20261014T130000Z", { start: "2026-10-14T13:00:00Z", extra: { ...base, originalStartTime: { dateTime: "2026-10-14T13:00:00Z" } } }));
    await sync();
    expect(await db.visit.count()).toBe(2);
    // ocorrência remarcada (exceção) mantém o mesmo id da instância
    api.put(visitEvent("serie_20261014T130000Z", { start: "2026-10-15T18:00:00Z", extra: { ...base, originalStartTime: { dateTime: "2026-10-14T13:00:00Z" } } }));
    await sync({ now: new Date(NOW.getTime() + 60_000) });
    expect(await db.visit.count()).toBe(2);
    const moved = await db.visit.findFirstOrThrow({ where: { sourceEvent: { googleEventId: "serie_20261014T130000Z" } } });
    expect(moved.scheduledStart.toISOString()).toBe("2026-10-15T18:00:00.000Z");
  });

  it("cancelamento: visita sem resultado é cancelada automaticamente; com resultado vira conflito e mantém o resultado", async () => {
    api.put(visitEvent("open", { start: "2026-10-08T13:00:00Z" }));
    api.put(visitEvent("done", { start: "2026-10-06T12:00:00Z" }));
    await sync();
    const done = await db.visit.findFirstOrThrow({ where: { sourceEvent: { googleEventId: "done" } } });
    await concludeVisit(users.a, done.id, { requestId: "req-done-1", expectedVersion: done.version, status: "DONE", evaluation: "POSITIVE", note: "Gostou muito" }, NOW);

    api.cancel("open");
    api.cancel("done");
    await sync({ now: new Date(NOW.getTime() + 60_000) });

    const open = await db.visit.findFirstOrThrow({ where: { sourceEvent: { googleEventId: "open" } } });
    expect(open).toMatchObject({ status: "CANCELED", autoCanceled: true });
    const doneAfter = await db.visit.findUniqueOrThrow({ where: { id: done.id } });
    expect(doneAfter).toMatchObject({ status: "DONE", evaluation: "POSITIVE", note: "Gostou muito", syncConflict: "CANCELED_IN_GOOGLE" });
    expect(doneAfter.opportunityId).not.toBeNull();
  });

  it("Google não sobrescreve dados de visita concluída nem correções manuais", async () => {
    api.put(visitEvent("ev", { start: "2026-10-06T12:00:00Z" }));
    await sync();
    const v = await db.visit.findFirstOrThrow();
    await concludeVisit(users.a, v.id, { requestId: "req-x-1234", expectedVersion: v.version, status: "DONE", evaluation: "UNDECIDED", note: "Vai pensar" }, NOW);
    api.put(visitEvent("ev", { start: "2026-10-06T12:00:00Z", title: "Visita clt - Outro Nome - cod 999 - (51) 99876-5432" }));
    await sync({ now: new Date(NOW.getTime() + 60_000) });
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    expect(after).toMatchObject({ clientName: "Cliente Exemplo", propertyCode: "654321", syncConflict: "CHANGED_AFTER_CONCLUSION", note: "Vai pensar" });
  });

  it("token inválido (410) reconstrói o espelho sem apagar resultados", async () => {
    api.put(visitEvent("ev", { start: "2026-10-06T12:00:00Z" }));
    await sync();
    const v = await db.visit.findFirstOrThrow();
    await concludeVisit(users.a, v.id, { requestId: "req-410-1", expectedVersion: v.version, status: "NO_SHOW", note: "Cliente não apareceu" }, NOW);
    api.invalidateTokens = true;
    const stats = await sync({ now: new Date(NOW.getTime() + 60_000) });
    expect(stats.mode).toBe("full");
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    expect(after).toMatchObject({ status: "NO_SHOW", note: "Cliente não apareceu" });
    expect(await db.visit.count()).toBe(1);
  });

  it("expande a janela futura explicitamente com o passar dos dias", async () => {
    await sync();
    const farFuture = new Date(NOW.getTime() + 95 * 86400_000).toISOString();
    api.put(visitEvent("far", { start: farFuture }));
    // incremental informa o evento, mas ele está fora da janela atual → ignorado
    await sync({ now: new Date(NOW.getTime() + 60_000) });
    expect(await db.visit.count()).toBe(0);
    // 6 dias depois a janela avança e o trecho novo é listado explicitamente
    const later = new Date(NOW.getTime() + 6 * 86400_000);
    await db.syncState.updateMany({ data: { lastReconcileAt: later } }); // evita reconciliação completa para isolar a expansão
    const stats = await sync({ now: later });
    expect(stats.windowExtended).toBe(true);
    expect(await db.visit.count()).toBe(1);
  });

  it("reconciliação detecta evento conhecido que sumiu da listagem", async () => {
    api.put(visitEvent("gone", { start: "2026-10-08T13:00:00Z" }));
    await sync();
    api.purge("gone");
    await sync({ now: new Date(NOW.getTime() + 2 * 86400_000) }); // > 24h → reconciliação completa
    const v = await db.visit.findFirstOrThrow();
    expect(v).toMatchObject({ status: "CANCELED", autoCanceled: true });
  });

  it("evento recriado com mesmo iCalUID e ocorrência é religado; semelhante por telefone vai para revisão", async () => {
    api.put(visitEvent("old", { start: "2026-10-06T12:00:00Z", extra: { iCalUID: "same@google.com" } }));
    await sync();
    const v = await db.visit.findFirstOrThrow();
    await concludeVisit(users.a, v.id, { requestId: "req-rec-1", expectedVersion: v.version, status: "DONE", evaluation: "POSITIVE", note: "ok" }, NOW);
    api.cancel("old");
    api.put(visitEvent("new", { start: "2026-10-06T12:00:00Z", extra: { iCalUID: "same@google.com" } }));
    // evento diferente, mesmo telefone/imóvel, sem evidência forte
    api.put(visitEvent("weak", { start: "2026-10-09T12:00:00Z" }));
    await sync({ now: new Date(NOW.getTime() + 60_000) });
    const relinked = await db.visit.findUniqueOrThrow({ where: { id: v.id }, include: { sourceEvent: true } });
    expect(relinked.sourceEvent?.googleEventId).toBe("new");
    expect(relinked).toMatchObject({ status: "DONE", syncConflict: "NONE" });
    const weak = await db.visit.findFirstOrThrow({ where: { sourceEvent: { googleEventId: "weak" } } });
    expect(weak.syncConflict).toBe("NONE"); // visita anterior não foi cancelada → sem suspeita
  });
});

describe("concorrência, falhas e reinício (critérios 5 e 12)", () => {
  it("duas execuções simultâneas: apenas uma obtém o bloqueio e não há duplicação", async () => {
    for (let i = 0; i < 6; i++) api.put(visitEvent(`c${i}`, { start: `2026-10-07T1${i}:00:00Z` }));
    const runA = await db.syncRun.create({ data: { trigger: "SCHEDULED", status: "QUEUED" } });
    const runB = await db.syncRun.create({ data: { trigger: "MANUAL", status: "QUEUED" } });
    const slowApi = async () => {
      const original = api.listEvents.bind(api);
      api.listEvents = async (p) => {
        await new Promise((r) => setTimeout(r, 50));
        return original(p);
      };
      return api;
    };
    const [ra, rb] = await Promise.all([executeRun(runA.id, slowApi, { now: NOW }), executeRun(runB.id, async () => api, { now: NOW })]);
    expect([ra.ran, rb.ran].filter(Boolean)).toHaveLength(1);
    expect(await db.visit.count()).toBe(6);
    const statuses = (await db.syncRun.findMany()).map((r) => r.status).sort();
    expect(statuses).toEqual(["SKIPPED", "SUCCESS"]);
  });

  it("falha temporária é repetida com backoff; falha de autorização marca reconexão necessária", async () => {
    api.put(visitEvent("ev", { start: "2026-10-07T13:00:00Z" }));
    api.failNext = [new GoogleApiError("RETRYABLE", 503), new GoogleApiError("RETRYABLE", 429, 10)];
    await sync();
    expect(await db.visit.count()).toBe(1);

    api.failNext = [new GoogleApiError("AUTH", 400, null, "invalid_grant")];
    const run = await db.syncRun.create({ data: { trigger: "SCHEDULED", status: "QUEUED" } });
    await executeRun(run.id, async () => api, { now: NOW });
    expect((await db.syncRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("FAILED");
    const conn = await db.googleConnection.findFirstOrThrow();
    expect(conn.status).toBe("NEEDS_RECONNECT");
    const state = await db.syncState.findFirstOrThrow();
    expect(state.consecutiveFailures).toBe(1);
    expect(state.nextAttemptAt).not.toBeNull();
    // dados registrados continuam acessíveis
    expect(await db.visit.count()).toBe(1);
  });

  it("calendário com acesso só a ocupado/livre não importa", async () => {
    await db.googleConnection.updateMany({ data: { calendarAccessRole: "freeBusyReader" } });
    await expect(sync()).rejects.toMatchObject({ code: "FREEBUSY_ONLY" });
  });

  it("estado persiste após 'reinício': nova instância continua do syncToken salvo", async () => {
    api.put(visitEvent("ev", { start: "2026-10-07T13:00:00Z" }));
    await sync();
    const state = await db.syncState.findFirstOrThrow();
    expect(state.syncToken).toMatch(/^tok-/);
    // simula novo processo: novo objeto de API, mesmo banco
    const api2 = new MockCalendar();
    api2.put(visitEvent("ev", { start: "2026-10-07T13:00:00Z" }));
    api = api2;
    const stats = await sync({ now: new Date(NOW.getTime() + 60_000) });
    expect(stats.mode).toBe("incremental");
    expect(api2.calls[0].syncToken).toBe(state.syncToken);
  });

  it("lock é liberado após término", async () => {
    const r1 = await withSyncLock(async () => 1);
    const r2 = await withSyncLock(async () => 2);
    expect(r1.ran && r2.ran).toBe(true);
  });
});
