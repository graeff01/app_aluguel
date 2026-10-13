// Barreiras para erros e gargalos do dia a dia (pré-análise, alertas, duplicidades, conflitos, ausência).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { assignmentQueue, createPreAnalysis, resolvePreAnalysis } from "@/server/pre-analysis";
import { sendOperationalAlerts, type Sender } from "@/server/reminders";
import { rescheduleVisit } from "@/server/reschedule";
import { createManualVisit } from "@/server/visits";
import { runSync } from "@/server/sync/engine";
import { toLocalInput } from "@/lib/time";
import { makeConnection, makeUsers, resetDb } from "../helpers/db";
import { MockCalendar, visitEvent } from "../helpers/mock-calendar";

let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
const NOW = new Date("2026-10-13T15:00:00Z"); // 12:00 SP, terça
const H = 3600_000;
const pre = (o: Record<string, unknown> = {}) => ({
  fullName: "Maria Titular da Silva", birthDate: "1990-05-20", cpf: "529.982.247-25", email: "maria@exemplo.test", phone: "(51) 99876-1234", salary: "4.500,00",
  consultantId: u.a.id, propertyCode: "", note: "", holderConfirmed: true as const, ...o,
});
const local = (d: Date) => toLocalInput(d);

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  const j = await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } });
  jasmin = { id: j.id, role: "PRE_SERVICE" };
  await db.appSettings.update({ where: { id: 1 }, data: { remindersEnabled: true } });
});

describe("pré-análise: duplicidade, repetição e ausência", () => {
  it("toque duplo não duplica; CPF em aberto bloqueia; CPF recente pede confirmação", async () => {
    const a = await createPreAnalysis(jasmin, pre({ requestId: "req-1" }), NOW);
    expect((await createPreAnalysis(jasmin, pre({ requestId: "req-1" }), NOW)).id).toBe(a.id);
    expect(await db.preAnalysis.count()).toBe(1);
    await expect(createPreAnalysis(jasmin, pre({ requestId: "req-2", consultantId: u.b.id }), NOW)).rejects.toMatchObject({ code: "CONFLICT" });
    await resolvePreAnalysis(u.a, a.id, { status: "REJECTED", note: "Renda insuficiente" }, NOW);
    await expect(createPreAnalysis(jasmin, pre({ requestId: "req-3" }), NOW)).rejects.toMatchObject({ code: "VALIDATION", details: { confirmRepeat: expect.any(String) } });
    expect((await createPreAnalysis(jasmin, pre({ requestId: "req-4", confirmRepeat: true }), NOW)).id).not.toBe(a.id);
  });

  it("consultora ausente: o rodízio pula e o envio pede confirmação", async () => {
    await db.user.update({ where: { id: u.a.id }, data: { awayUntil: new Date("2026-10-15T00:00:00Z") } });
    const q = await assignmentQueue(NOW);
    expect(q.find((c) => c.isNext)?.id).toBe(u.b.id);
    expect(q.find((c) => c.id === u.a.id)).toMatchObject({ away: true, awayUntil: "15/10" });
    await expect(createPreAnalysis(jasmin, pre(), NOW)).rejects.toMatchObject({ details: { confirmAway: expect.any(String) } });
    await createPreAnalysis(jasmin, pre({ confirmAway: true }), NOW);
    // depois da data volta ao rodízio
    expect((await assignmentQueue(new Date("2026-10-16T15:00:00Z"))).some((c) => c.away)).toBe(false);
  });
});

describe("alertas de gargalo", () => {
  async function subs() {
    await db.pushSubscription.createMany({ data: [u.a, u.manager].map((x, i) => ({ userId: x.id, endpoint: `https://push.test/${i}`, p256dh: "k", auth: "a" })).concat([{ userId: jasmin.id, endpoint: "https://push.test/j", p256dh: "k", auth: "a" }]) });
  }
  it("visita sem consultora avisa gestão e pré-atendimento uma vez, sem dados do cliente", async () => {
    await subs();
    await db.visit.create({ data: { origin: "GOOGLE", assignmentStatus: "NEEDS_REVIEW", clientName: "Cliente Secreto", propertyCode: "761739", scheduledStart: new Date(NOW.getTime() + 5 * H), scheduledEnd: new Date(NOW.getTime() + 6 * H) } });
    const sent: { endpoint: string; title: string }[] = [];
    const send: Sender = async (t, p) => (sent.push({ endpoint: t.endpoint, title: p.title }), "ok");
    await sendOperationalAlerts(NOW, { send, email: null });
    await sendOperationalAlerts(new Date(NOW.getTime() + 60_000), { send, email: null });
    expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push.test/1", "https://push.test/j"]);
    expect(sent[0].title).toBe("Visita sem consultora: 13/10 às 17:00");
    expect(JSON.stringify(sent)).not.toContain("Secreto");
  });

  it("pré-análise sem resposta: lembra a consultora em 2 h e escala em 24 h", async () => {
    await subs();
    const p = await createPreAnalysis(jasmin, pre(), new Date(NOW.getTime() - 25 * H));
    await db.preAnalysis.update({ where: { id: p.id }, data: { createdAt: new Date(NOW.getTime() - 25 * H) } });
    const titles: [string, string][] = [];
    await sendOperationalAlerts(NOW, { send: async (t, pl) => (titles.push([t.endpoint, pl.title]), "ok"), email: null });
    expect(titles).toContainEqual(["https://push.test/0", "Pré-análise esperando sua resposta"]);
    expect(titles.filter((t) => t[1] === "Pré-análise sem resposta há mais de 24 h").map((t) => t[0]).sort()).toEqual(["https://push.test/1", "https://push.test/j"]);
  });

  it("aprovada há 3 dias sem visita para o telefone avisa o pré-atendimento; com visita, não", async () => {
    await subs();
    const p = await createPreAnalysis(jasmin, pre(), new Date(NOW.getTime() - 5 * 24 * H));
    await resolvePreAnalysis(u.a, p.id, { status: "APPROVED", note: "Aprovado" }, new Date(NOW.getTime() - 4 * 24 * H));
    const t1: string[] = [];
    await sendOperationalAlerts(NOW, { send: async (_t, pl) => (t1.push(pl.title), "ok"), email: null });
    expect(t1).toContain("1 pré-análise aprovada sem visita marcada");

    await resetDb();
    u = await makeUsers();
    const j = await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } });
    jasmin = { id: j.id, role: "PRE_SERVICE" };
    await db.appSettings.update({ where: { id: 1 }, data: { remindersEnabled: true } });
    await subs();
    const p2 = await createPreAnalysis(jasmin, pre(), new Date(NOW.getTime() - 5 * 24 * H));
    await resolvePreAnalysis(u.a, p2.id, { status: "APPROVED", note: "Aprovado" }, new Date(NOW.getTime() - 4 * 24 * H));
    await createManualVisit(u.admin, { requestId: "has-visit-req", scheduledStart: local(new Date(NOW.getTime() + 24 * H)), clientName: "Maria Titular", phoneRaw: "(51) 99876-1234", propertyCode: "761739", consultantId: u.a.id });
    const t2: string[] = [];
    await sendOperationalAlerts(NOW, { send: async (_t, pl) => (t2.push(pl.title), "ok"), email: null });
    expect(t2.some((t) => t.includes("aprovada sem visita"))).toBe(false);
  });

  it("reagendamento sem o evento salvo no Google lembra a consultora", async () => {
    await subs();
    const old = await createManualVisit(u.admin, { requestId: "link-old-req", scheduledStart: local(new Date(NOW.getTime() - H)), clientName: "Cliente Link", phoneRaw: "", propertyCode: "761739", consultantId: u.a.id });
    const nv = await rescheduleVisit(u.a, old.id, { requestId: "lk", scheduledStart: local(new Date(NOW.getTime() + 24 * H)), durationMinutes: 60, mode: "reschedule" }, new Date(NOW.getTime() - H));
    await db.visit.update({ where: { id: nv.id }, data: { createdAt: new Date(NOW.getTime() - H) } });
    const t: string[] = [];
    await sendOperationalAlerts(NOW, { send: async (_t, pl) => (t.push(pl.title), "ok"), email: null });
    expect(t.some((x) => x.startsWith("Falta pôr na agenda a visita de 14/10"))).toBe(true);
  });
});

describe("duplicidade e conflito ao reagendar", () => {
  it("evento criado à mão (sem código) com mesmo telefone e imóvel liga à visita já criada", async () => {
    await makeConnection();
    const old = await createManualVisit(u.admin, { requestId: "dup-old-req", scheduledStart: local(new Date(NOW.getTime() + 2 * H)), clientName: "Cliente Dup", phoneRaw: "(51) 99876-4321", propertyCode: "654321", consultantId: u.a.id });
    const nv = await rescheduleVisit(u.a, old.id, { requestId: "dup", scheduledStart: local(new Date("2026-10-14T18:00:00Z")), durationMinutes: 60, mode: "reschedule" }, NOW);
    const api = new MockCalendar();
    api.put(visitEvent("manual", { title: "Visita clt - Cliente Dup - cod 654321 - (51) 99876-4321", start: "2026-10-14T19:00:00Z" }));
    await runSync({ api, now: NOW, sleep: async () => {} });
    expect(await db.visit.count()).toBe(2);
    expect((await db.visit.findUniqueOrThrow({ where: { id: nv.id } })).sourceEventId).not.toBeNull();
  });

  it("reagendar em cima de outra visita da consultora avisa; com confirmação marca", async () => {
    await createManualVisit(u.admin, { requestId: "busy-req", scheduledStart: local(new Date("2026-10-14T18:00:00Z")), clientName: "Cliente Ocupa", phoneRaw: "", propertyCode: "111111", consultantId: u.a.id });
    const old = await createManualVisit(u.admin, { requestId: "ov-old-req", scheduledStart: local(new Date(NOW.getTime() + 2 * H)), clientName: "Cliente Novo", phoneRaw: "", propertyCode: "222222", consultantId: u.a.id });
    const input = { requestId: "ov", scheduledStart: local(new Date("2026-10-14T18:30:00Z")), durationMinutes: 60, mode: "reschedule" as const };
    await expect(rescheduleVisit(u.a, old.id, input, NOW)).rejects.toMatchObject({ code: "VALIDATION", details: { allowOverlap: expect.any(String) } });
    expect((await rescheduleVisit(u.a, old.id, { ...input, allowOverlap: true }, NOW)).status).toBe("SCHEDULED");
  });
});
