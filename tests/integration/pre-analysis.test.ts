// Pré-análise (LGPD: criptografia, escopo, retenção) e cancelamento por evento movido para depois das 21h.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ageOn, assignmentQueue, createPreAnalysis, incomeBand, isValidCpf, listPreAnalyses, parseMoney, preAnalysisDetail, preAnalysisStats, resolvePreAnalysis, runPreAnalysisRetention } from "@/server/pre-analysis";
import { canCreateManualVisit } from "@/lib/authz";
import { runSync, LATE_CANCEL_NOTE } from "@/server/sync/engine";
import { concludeVisit } from "@/server/visits";
import { makeConnection, makeUsers, resetDb } from "../helpers/db";
import { MockCalendar, visitEvent } from "../helpers/mock-calendar";

let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
const NOW = new Date("2026-10-13T15:00:00Z");
const valid = (o: Partial<Parameters<typeof createPreAnalysis>[1]> = {}) => ({
  fullName: "Maria Titular da Silva",
  birthDate: "1990-05-20",
  cpf: "529.982.247-25",
  email: "maria@exemplo.test",
  phone: "(51) 99876-1234",
  salary: "4.500,00",
  consultantId: u.a.id,
  propertyCode: "761739",
  note: "",
  holderConfirmed: true as const,
  ...o,
});

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  const j = await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } });
  jasmin = { id: j.id, role: "PRE_SERVICE" };
});

describe("validações", () => {
  it("CPF, valores, faixa de renda e idade", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123.456.789-00")).toBe(false);
    expect(parseMoney("4.500,00")).toBe(450000);
    expect(parseMoney("R$ 2.300")).toBe(230000);
    expect(parseMoney("4500.50")).toBe(450050);
    expect(parseMoney("abc")).toBeNull();
    expect([incomeBand(150000), incomeBand(450000), incomeBand(1200000)]).toEqual(["ate2k", "4a6k", "10kmais"]);
    expect(ageOn("2008-10-14", NOW)).toBe(17);
    expect(ageOn("2008-10-13", NOW)).toBe(18);
  });
});

describe("pré-análise", () => {
  it("pré-atendimento envia; dados ficam criptografados; só a consultora encaminhada e a gestão veem", async () => {
    await expect(createPreAnalysis(u.a, valid(), NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createPreAnalysis(jasmin, valid({ cpf: "111.111.111-11", birthDate: "2010-01-01" }), NOW)).rejects.toMatchObject({ code: "VALIDATION", details: { cpf: expect.any(String), birthDate: expect.any(String) } });
    await expect(createPreAnalysis(jasmin, valid({ consultantId: u.manager.id }), NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    const p = await createPreAnalysis(jasmin, valid(), NOW);

    const raw = await db.preAnalysis.findUniqueOrThrow({ where: { id: p.id } });
    expect(JSON.stringify(raw)).not.toMatch(/52998224725|maria@exemplo|450000|1990-05-20/);
    expect(raw).toMatchObject({ incomeBand: "4a6k", status: "AWAITING" });

    expect((await listPreAnalyses(u.a)).map((x) => x.id)).toEqual([p.id]);
    expect(await listPreAnalyses(u.b)).toHaveLength(0);
    expect(await listPreAnalyses(jasmin)).toHaveLength(1);
    await expect(preAnalysisDetail(u.b, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const d = await preAnalysisDetail(u.a, p.id, NOW);
    expect(d).toMatchObject({ cpf: "52998224725", email: "maria@exemplo.test", phone: "+5551998761234", salaryCents: 450000, age: 36, canResolve: true });
    expect(await db.auditLog.count({ where: { action: "preanalysis.viewed", entityId: p.id } })).toBe(1);
    expect((await preAnalysisDetail(jasmin, p.id, NOW)).canResolve).toBe(false);
  });

  it("consultora responde (pendente → aprovado); CPF repetido aparece; indicadores do mês", async () => {
    const p = await createPreAnalysis(jasmin, valid(), NOW);
    await expect(resolvePreAnalysis(jasmin, p.id, { status: "APPROVED", note: "ok" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resolvePreAnalysis(u.a, p.id, { status: "APPROVED", note: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await resolvePreAnalysis(u.a, p.id, { status: "PENDING", note: "Falta comprovante de renda" }, NOW);
    await resolvePreAnalysis(u.a, p.id, { status: "APPROVED", note: "Aprovado sem fiador" }, new Date(NOW.getTime() + 2 * 3600_000));
    const second = await createPreAnalysis(jasmin, { ...valid({ consultantId: u.b.id }), confirmRepeat: true }, NOW);
    await resolvePreAnalysis(u.b, second.id, { status: "REJECTED", note: "Renda insuficiente" }, NOW);
    expect((await preAnalysisDetail(u.manager, second.id, NOW)).previous.map((x) => x.id)).toEqual([p.id]);
    // a consultora B não vê a pré-análise da A, nem como "repetida"
    expect((await preAnalysisDetail(u.b, second.id, NOW)).previous).toHaveLength(0);

    const s = await preAnalysisStats(u.manager, new Date("2026-10-01T03:00:00Z"), new Date("2026-11-01T03:00:00Z"));
    expect(s).toMatchObject({ total: 2, approved: 1, rejected: 1, approvalRate: 0.5 });
    await expect(preAnalysisStats(u.a, new Date(0), NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("retenção: apaga os dados pessoais após o prazo e mantém nome, faixa e resultado", async () => {
    const p = await createPreAnalysis(jasmin, valid(), NOW);
    await resolvePreAnalysis(u.a, p.id, { status: "REJECTED", note: "Renda insuficiente" }, new Date(NOW.getTime() - 91 * 86400_000));
    const fresh = await createPreAnalysis(jasmin, valid({ cpf: "168.995.350-09" }), NOW);
    expect(await runPreAnalysisRetention(NOW)).toEqual({ purged: 1 });
    const gone = await db.preAnalysis.findUniqueOrThrow({ where: { id: p.id } });
    expect(gone).toMatchObject({ cpfEnc: null, birthDateEnc: null, emailEnc: null, phoneEnc: null, salaryEnc: null, cpfHash: null, fullName: "Maria Titular da Silva", incomeBand: "4a6k", status: "REJECTED" });
    expect(gone.purgedAt).not.toBeNull();
    expect((await db.preAnalysis.findUniqueOrThrow({ where: { id: fresh.id } })).cpfEnc).not.toBeNull();
    await expect(resolvePreAnalysis(u.a, p.id, { status: "APPROVED", note: "tentativa" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("rodízio: alterna entre as consultoras e marca a última a receber", async () => {
    const q0 = await assignmentQueue(NOW);
    expect(q0.find((c) => c.isNext)?.id).toBe(u.a.id); // ninguém recebeu: ordem alfabética
    expect(q0.some((c) => c.isLast)).toBe(false);
    await createPreAnalysis(jasmin, valid({ consultantId: u.a.id }), NOW);
    const q1 = await assignmentQueue(NOW);
    expect(q1.find((c) => c.isNext)?.id).toBe(u.b.id);
    expect(q1.find((c) => c.isLast)?.id).toBe(u.a.id);
    await new Promise((r) => setTimeout(r, 5));
    await createPreAnalysis(jasmin, valid({ consultantId: u.b.id, cpf: "168.995.350-09" }), NOW);
    const q2 = await assignmentQueue(NOW);
    expect(q2.find((c) => c.isNext)?.id).toBe(u.a.id);
    expect(q2.find((c) => c.isLast)?.id).toBe(u.b.id);
    expect(q2.find((c) => c.id === u.a.id)?.monthCount).toBe(1);
  });

  it("pré-atendimento não cria visita manual", async () => {
    expect(canCreateManualVisit(jasmin, { consultantCanCreateVisit: true, consultantCanCorrectData: true, consultantCanUpdateOpp: true })).toBe(false);
  });
});

describe("cancelamento: evento movido para depois das 21h", () => {
  it("cancela mantendo o horário original, restaura se voltar e cria já cancelada se chegar às 21h+", async () => {
    await makeConnection();
    const api = new MockCalendar();
    const sync = () => runSync({ api, now: new Date("2026-10-13T12:00:00Z"), sleep: async () => {} });
    api.put(visitEvent("c1", { start: "2026-10-13T17:00:00Z" })); // 14:00
    await sync();
    const v = await db.visit.findFirstOrThrow({ where: { sourceEvent: { googleEventId: "c1" } } });
    expect(v.status).toBe("SCHEDULED");

    api.put(visitEvent("c1", { start: "2026-10-14T00:30:00Z" })); // 21:30 do dia 13
    await sync();
    const canceled = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    expect(canceled).toMatchObject({ status: "CANCELED", autoCanceled: true, note: LATE_CANCEL_NOTE });
    expect(canceled.scheduledStart.toISOString()).toBe("2026-10-13T17:00:00.000Z"); // dia/horário originais

    api.put(visitEvent("c1", { start: "2026-10-13T18:00:00Z" })); // voltou para 15:00
    await sync();
    const back = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    expect(back).toMatchObject({ status: "SCHEDULED", autoCanceled: false, note: null });
    expect(back.scheduledStart.toISOString()).toBe("2026-10-13T18:00:00.000Z");

    api.put(visitEvent("c2", { start: "2026-10-14T01:00:00Z" })); // já criado às 22:00
    await sync();
    expect(await db.visit.findFirstOrThrow({ where: { sourceEvent: { googleEventId: "c2" } } })).toMatchObject({ status: "CANCELED", note: LATE_CANCEL_NOTE });
  });

  it("visita com resultado não muda; regra desligada (0) não cancela", async () => {
    await makeConnection();
    const api = new MockCalendar();
    const sync = () => runSync({ api, now: new Date("2026-10-13T20:00:00Z"), sleep: async () => {} });
    api.put(visitEvent("d1", { start: "2026-10-13T17:00:00Z" }));
    await sync();
    const v = await db.visit.findFirstOrThrow({ where: { sourceEvent: { googleEventId: "d1" } } });
    await concludeVisit(u.admin, v.id, { requestId: "late-done-req", expectedVersion: v.version, status: "DONE", evaluation: "POSITIVE", note: "gostou" }, new Date("2026-10-13T19:00:00Z"));
    api.put(visitEvent("d1", { start: "2026-10-14T00:30:00Z" }));
    await sync();
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("DONE");

    await db.appSettings.update({ where: { id: 1 }, data: { cancelAfterHour: 0 } });
    api.put(visitEvent("d2", { start: "2026-10-14T01:00:00Z" }));
    await sync();
    expect((await db.visit.findFirstOrThrow({ where: { sourceEvent: { googleEventId: "d2" } } })).status).toBe("SCHEDULED");
  });
});
