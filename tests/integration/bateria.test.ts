// Bateria de casos de borda das funcionalidades de 14–15/10 (documentos, pré-análise sem obrigatórios, rodízio,
// cancelamento parcial/Google, vários imóveis, marketing, telefone, leitura do título, agenda semana/mês).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { classifyTitle, DEFAULT_PATTERNS, parseVisitEvent, removeCodeFromTitle } from "@/lib/parser";
import { assignmentQueue, createPreAnalysis, runPreAnalysisRetention } from "@/server/pre-analysis";
import { addPreAnalysisFiles, readFiles, readPreAnalysisFile, MAX_FILE_BYTES } from "@/server/pre-analysis-files";
import { cancelVisitByStaff, concludeVisit, createManualVisit } from "@/server/visits";
import { markLeasePosted, updateOpportunity } from "@/server/opportunities";
import { rangeAgenda } from "@/server/day-agenda";
import { runSync } from "@/server/sync/engine";
import { toLocalInput } from "@/lib/time";
import { MockCalendar, visitEvent } from "../helpers/mock-calendar";
import { leaseInfo, makeConnection, makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
let mkt: { id: string; role: "MARKETING" };
const NOW = new Date("2026-10-13T15:00:00Z");
const H = 3600_000;
let seq = 0;
const pdf = (name = "doc.pdf") => new File(["%PDF-1.4\n%sintetico\n"], name, { type: "application/pdf" });
const visit = (start: string, code = "761739", consultantId?: string) =>
  createManualVisit(u.admin, { requestId: `bateria-${++seq}-req`, scheduledStart: toLocalInput(new Date(start)), clientName: "Cliente Bateria", phoneRaw: "(51) 99876-7777", propertyCode: code, consultantId: consultantId ?? u.a.id });
const cancelReason = (label = "Cliente desistiu") => db.reason.findFirstOrThrow({ where: { kind: "VISIT_CANCEL", label } });

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  jasmin = { id: (await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } })).id, role: "PRE_SERVICE" };
  mkt = { id: (await db.user.create({ data: { name: "Marketing", email: "mkt@exemplo.test", role: "MARKETING" } })).id, role: "MARKETING" };
});

// ───────────────────────── Documentos ─────────────────────────
describe("documentos: limites e segurança", () => {
  it("rejeita arquivo grande, demais, falso e ignora campo vazio", async () => {
    await expect(readFiles([new File([new Uint8Array(MAX_FILE_BYTES + 1)], "grande.pdf")])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(readFiles(Array.from({ length: 13 }, (_, i) => pdf(`d${i}.pdf`)))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(readFiles([new File(["<html><script>alert(1)</script>"], "rg.pdf", { type: "application/pdf" })])).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await readFiles([new File([], ""), pdf()])).toHaveLength(1); // input sem arquivo manda item vazio
  });

  it("aceita JPG, PNG, WEBP, HEIC e PDF pelo conteúdo e limpa o nome (sem caminho)", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic"), 0, 0]);
    const webp = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
    const out = await readFiles([new File([png], "../../etc/passwd.png"), new File([heic], "foto.HEIC"), new File([webp], "x.webp"), pdf("Comprovante de Renda (março).pdf")]);
    expect(out.map((f) => f.mime)).toEqual(["image/png", "image/heic", "image/webp", "application/pdf"]);
    expect(out[0].name).not.toContain("/");
    expect(out[3].name).toBe("Comprovante de Renda março.pdf");
  });

  it("até 12 por pré-análise somando os já anexados; depois da retenção não aceita mais", async () => {
    const p = await createPreAnalysis(jasmin, { consultantId: u.a.id }, NOW, Array.from({ length: 11 }, (_, i) => pdf(`d${i}.pdf`)));
    await expect(addPreAnalysisFiles(jasmin, p.id, [pdf("a.pdf"), pdf("b.pdf")])).rejects.toMatchObject({ code: "VALIDATION" });
    await addPreAnalysisFiles(jasmin, p.id, [pdf("a.pdf")]);
    await runPreAnalysisRetention(new Date(NOW.getTime() + 200 * 24 * H));
    await expect(addPreAnalysisFiles(jasmin, p.id, [pdf("c.pdf")])).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("marketing e outra consultora não abrem; documento de outra pré-análise não abre pelo id trocado", async () => {
    const p1 = await createPreAnalysis(jasmin, { consultantId: u.a.id }, NOW, [pdf()]);
    const p2 = await createPreAnalysis(jasmin, { consultantId: u.b.id }, NOW, [pdf()]);
    const f1 = await db.preAnalysisFile.findFirstOrThrow({ where: { preAnalysisId: p1.id } });
    await expect(readPreAnalysisFile(mkt, p1.id, f1.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(readPreAnalysisFile(u.b, p1.id, f1.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(readPreAnalysisFile(u.b, p2.id, f1.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); // id de outra pré-análise
    expect((await readPreAnalysisFile(u.manager, p1.id, f1.id)).mime).toBe("application/pdf");
  });
});

// ───────────────────────── Pré-análise sem obrigatórios ─────────────────────────
describe("pré-análise sem campos obrigatórios", () => {
  it("duas sem CPF não se bloqueiam; CPF repetido continua barrado", async () => {
    await createPreAnalysis(jasmin, { consultantId: u.a.id }, NOW);
    await createPreAnalysis(jasmin, { consultantId: u.a.id }, NOW);
    await createPreAnalysis(jasmin, { consultantId: u.a.id, cpf: "529.982.247-25" }, NOW);
    await expect(createPreAnalysis(jasmin, { consultantId: u.b.id, cpf: "529.982.247-25" }, NOW)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("valida só o que veio: menor de idade, salário e e-mail inválidos", async () => {
    await expect(createPreAnalysis(jasmin, { consultantId: u.a.id, birthDate: "2015-01-01", salary: "abc", email: "sem-arroba" }, NOW)).rejects.toMatchObject({
      code: "VALIDATION",
      details: { birthDate: expect.any(String), salary: expect.any(String), email: expect.any(String) },
    });
  });

  it("sem consultora não envia; consultora inativa não recebe", async () => {
    await expect(createPreAnalysis(jasmin, { consultantId: "" }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    await db.user.update({ where: { id: u.b.id }, data: { active: false } });
    await expect(createPreAnalysis(jasmin, { consultantId: u.b.id }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("aprovada sem telefone/nome ainda agenda a visita", async () => {
    const { resolvePreAnalysis } = await import("@/server/pre-analysis");
    const { scheduleFromPreAnalysis } = await import("@/server/pre-visit");
    const p = await createPreAnalysis(jasmin, { consultantId: u.a.id }, NOW);
    await resolvePreAnalysis(u.a, p.id, { status: "APPROVED", note: "aprovado" }, NOW);
    const v = await scheduleFromPreAnalysis(u.a, p.id, { requestId: "bateria-pre-1", scheduledStart: toLocalInput(new Date(NOW.getTime() + 24 * H)), durationMinutes: 60, propertyCode: "761739" }, NOW);
    expect(v).toMatchObject({ clientName: null, phoneRaw: null, preAnalysisId: p.id });
  });
});

// ───────────────────────── Rodízio ─────────────────────────
describe("rodízio", () => {
  it("ninguém recebeu ainda: ordem alfabética; ausente sai da vez; todas ausentes segue normal", async () => {
    let q = await assignmentQueue(NOW);
    expect(q.find((c) => c.isNext)?.name).toBe("Consultora A");
    await db.user.update({ where: { id: u.a.id }, data: { awayUntil: new Date("2026-10-20T00:00:00Z") } });
    q = await assignmentQueue(NOW);
    expect(q.find((c) => c.isNext)?.name).toBe("Consultora B");
    await db.user.update({ where: { id: u.b.id }, data: { awayUntil: new Date("2026-10-20T00:00:00Z") } });
    q = await assignmentQueue(NOW);
    expect(q.filter((c) => c.isNext)).toHaveLength(1);
  });

  it("vez alterna A → B → A; 'cliente da consultora' não mexe em quem é a última a receber", async () => {
    await createPreAnalysis(jasmin, { consultantId: u.a.id }, new Date(NOW.getTime() - 2 * H));
    expect((await assignmentQueue(NOW)).find((c) => c.isNext)?.id).toBe(u.b.id);
    await createPreAnalysis(jasmin, { consultantId: u.b.id }, new Date(NOW.getTime() - H));
    await createPreAnalysis(jasmin, { consultantId: u.a.id, ownClient: true }, NOW);
    const q = await assignmentQueue(new Date(NOW.getTime() + 60_000));
    expect(q.find((c) => c.isNext)?.id).toBe(u.a.id);
    expect(q.find((c) => c.isLast)?.id).toBe(u.b.id);
  });
});

// ───────────────────────── Cancelamento ─────────────────────────
describe("cancelamento pelo pré-atendimento", () => {
  it("permissões, motivo inativo, visita já concluída", async () => {
    const v = await visit("2026-10-14T15:00:00Z");
    const r = await cancelReason();
    await expect(cancelVisitByStaff(mkt, v.id, { reasonId: r.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cancelVisitByStaff(u.b, v.id, { reasonId: r.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.reason.update({ where: { id: r.id }, data: { active: false } });
    await expect(cancelVisitByStaff(jasmin, v.id, { reasonId: r.id })).rejects.toMatchObject({ code: "VALIDATION" });
    const past = await visit("2026-10-13T12:00:00Z", "222222");
    await concludeVisit(u.a, past.id, { requestId: "bateria-done-1", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "ok" }, NOW);
    await expect(cancelVisitByStaff(jasmin, past.id, { reasonId: (await cancelReason("Outro")).id, note: "x" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("Google: sem permissão de edição, falha do Google e evento da consultora", async () => {
    await makeConnection("central@exemplo.test");
    const api = new MockCalendar();
    api.put(visitEvent("e1", { start: "2026-10-14T15:00:00Z", title: "Visita clt - Cliente Exemplo 1234567 - cod 111111;222222 - 51 99876-5432", organizer: "consultora.a@exemplo.test" }));
    api.put(visitEvent("e2", { start: "2026-10-14T18:00:00Z", title: "Visita clt - Outro Cliente 7654321 - cod 333333 - 51 99876-1111", organizer: "central@exemplo.test" }));
    api.put(visitEvent("e3", { start: "2026-10-15T15:00:00Z", title: "Visita clt - Terceiro Cliente 1112223 - cod 444444 - 51 99876-2222", organizer: "central@exemplo.test" }));
    await runSync({ api, now: NOW, sleep: async () => {} });
    const r = await cancelReason();
    const byCode = async (c: string) => db.visit.findFirstOrThrow({ where: { propertyCode: c } });

    // conexão real só com leitura: cancela no app e avisa (sem tocar no Google)
    expect((await cancelVisitByStaff(jasmin, (await byCode("333333")).id, { reasonId: r.id }, NOW)).google).toBe("no_permission");

    // evento organizado pela consultora: só um imóvel → não dá para editar o título dela
    expect((await cancelVisitByStaff(jasmin, (await byCode("111111")).id, { reasonId: r.id, onlyThis: true }, NOW, { calendarApi: api })).google).toBe("not_owner");
    // o restante → sai só da agenda conectada (cópia de convidada)
    expect((await cancelVisitByStaff(jasmin, (await byCode("222222")).id, { reasonId: r.id }, NOW, { calendarApi: api })).google).toBe("removed");

    // Google fora do ar: a visita fica cancelada no app mesmo assim
    const v3 = await byCode("444444");
    const broken = { cancelEvent: async () => Promise.reject(Object.assign(new Error("Google fora"), { kind: "RETRYABLE" })) } as unknown as MockCalendar;
    expect((await cancelVisitByStaff(jasmin, v3.id, { reasonId: r.id }, NOW, { calendarApi: broken })).google).toBe("error");
    expect((await db.visit.findUniqueOrThrow({ where: { id: v3.id } })).status).toBe("CANCELED");
  });

  it("sincronização depois de cancelamentos: horário mudado, código novo e evento apagado", async () => {
    await makeConnection("central@exemplo.test");
    const api = new MockCalendar();
    const ev = (start: string, codes: string) => visitEvent("m", { start, title: `Visita clt - Cliente Exemplo 1234567 - cod ${codes} - 51 99876-5432`, organizer: "central@exemplo.test" });
    api.put(ev("2026-10-14T15:00:00Z", "111111;222222;333333"));
    const sync = () => runSync({ api, now: NOW, sleep: async () => {} });
    await sync();
    const r = await cancelReason();
    const first = await db.visit.findFirstOrThrow({ where: { propertyCode: "111111" } });
    await cancelVisitByStaff(jasmin, first.id, { reasonId: r.id, onlyThis: true }, NOW, { calendarApi: api });
    // Jasmin muda o horário e acrescenta um imóvel no Google
    api.put(ev("2026-10-14T17:00:00Z", "222222;333333;444444"));
    await sync();
    const all = await db.visit.findMany({ orderBy: { createdAt: "asc" } });
    expect(all.map((v) => [v.propertyCode, v.status, v.syncConflict, v.scheduledStart.toISOString()])).toEqual([
      ["111111", "CANCELED", "NONE", "2026-10-14T15:00:00.000Z"],
      ["222222", "SCHEDULED", "NONE", "2026-10-14T17:00:00.000Z"],
      ["333333", "SCHEDULED", "NONE", "2026-10-14T17:00:00.000Z"],
      ["444444", "SCHEDULED", "NONE", "2026-10-14T17:00:00.000Z"],
    ]);
    // apagou o evento: tudo cancelado, nada de conflito
    api.cancel("m");
    await sync();
    expect((await db.visit.findMany()).every((v) => v.status === "CANCELED" && v.syncConflict === "NONE")).toBe(true);
  });
});

// ───────────────────────── Marketing ─────────────────────────
describe("marketing", () => {
  const ready = async () => {
    const v = await visit("2026-10-10T13:00:00Z");
    await concludeVisit(u.a, v.id, { requestId: `bateria-done-${++seq}`, expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "gostou" }, NOW);
    return db.opportunity.findFirstOrThrow();
  };

  it("agenciador desativado não vale; diferencial de outra lista é ignorado", async () => {
    const o = await ready();
    const info = await leaseInfo();
    await db.reason.update({ where: { id: info.agentId }, data: { active: false } });
    await expect(updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "CLOSED_WON", closedAt: "2026-10-12", ...info })).rejects.toMatchObject({ code: "VALIDATION" });
    await db.reason.update({ where: { id: info.agentId }, data: { active: true } });
    const wrong = await db.reason.findFirstOrThrow({ where: { kind: "VISIT_NEGATIVE" } });
    await updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "CLOSED_WON", closedAt: "2026-10-12", highlightIds: [wrong.id], ...info });
    expect((await db.leasePost.findFirstOrThrow()).highlights).toEqual([]);
  });

  it("depois de postado, reabrir não apaga o histórico; fechar de novo volta para 'para postar'", async () => {
    const o = await ready();
    await updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "CLOSED_WON", closedAt: "2026-10-12", ...(await leaseInfo()) });
    const post = await db.leasePost.findFirstOrThrow();
    await markLeasePosted(mkt, post.id, true);
    let cur = await db.opportunity.findUniqueOrThrow({ where: { id: o.id } });
    await updateOpportunity(u.manager, o.id, { expectedVersion: cur.version, toStatus: "FOLLOW_UP", note: "contrato caiu" });
    expect(await db.leasePost.count()).toBe(1); // postado fica registrado
    cur = await db.opportunity.findUniqueOrThrow({ where: { id: o.id } });
    await updateOpportunity(u.manager, o.id, { expectedVersion: cur.version, toStatus: "CLOSED_WON", closedAt: "2026-10-13", ...(await leaseInfo()) });
    expect((await db.leasePost.findFirstOrThrow()).postedAt).toBeNull();
  });

  it("data futura e versão desatualizada são barradas", async () => {
    const o = await ready();
    await expect(updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "CLOSED_WON", closedAt: "2099-01-01", ...(await leaseInfo()) })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateOpportunity(u.a, o.id, { expectedVersion: o.version + 5, toStatus: "CLOSED_WON", closedAt: "2026-10-12", ...(await leaseInfo()) })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ───────────────────────── Telefone e título ─────────────────────────
describe("telefone e leitura do título: formatos que aparecem na agenda", () => {
  it.each([
    ["51 9348-4750", "+5551993484750"],
    ["(51)9 9876-5432", "+5551998765432"],
    ["51998765432", "+5551998765432"],
    ["+55 51 99876-5432", "+5551998765432"],
    ["51 3333-4444", "+555133334444"],
    ["53 98426.0650", "+5553984260650"],
  ])("%s → %s", (raw, e164) => expect(normalizePhone(raw).normalized).toBe(e164));

  it("sem DDD continua sem DDD (não inventa)", () => expect(normalizePhone("9348-4750")).toMatchObject({ valid: false, problem: "SEM_DDD" }));

  it.each([
    ["Visita clt - Ana 2964 - cod 123456 ; 654321 - 51 99999-9999", "123456", ["654321"]],
    ["Visita clt - Ana 2964 - cód.: 123456 - 51 99999-9999", "123456", []],
    ["VISITA CLT - Ana 2964 - COD 123456 - 51 99999-9999", "123456", []],
    ["Visita clt - Ana - cod 123456,654321,777777 - (51) 99999-9999", "123456", ["654321", "777777"]],
  ])("%s", (title, code, extra) => {
    const c = classifyTitle(title, DEFAULT_PATTERNS);
    expect(c.cls).toBe("VISIT");
    const p = parseVisitEvent(title, null, c.cls === "VISIT" ? c.prefix : "");
    expect(p.propertyCode).toBe(code);
    expect(p.extraPropertyCodes).toEqual(extra);
    expect(p.phoneNormalized).toBe("+5551999999999");
  });

  it("tirar código: não mexe no telefone nem em código parecido", () => {
    expect(removeCodeFromTitle("Visita clt - Ana - cod 111111;1111112 - 51 99999-9999", "111111")).toBe("Visita clt - Ana - cod 1111112 - 51 99999-9999");
    expect(removeCodeFromTitle("Visita clt - Ana - cod 111111 - 51 99999-9999", "99999")).toBe("Visita clt - Ana - cod 111111 - 51 99999-9999");
  });
});

// ───────────────────────── Agenda semana/mês ─────────────────────────
describe("agenda por período no fuso de Brasília", () => {
  it("visita às 23:30 do último dia do mês fica no mês certo", async () => {
    await visit("2026-11-01T02:30:00Z"); // 31/10 23:30 em Brasília
    expect((await rangeAgenda(jasmin, "2026-10-01", "2026-11-01")).total).toBe(1);
    expect((await rangeAgenda(jasmin, "2026-11-01", "2026-12-01")).total).toBe(0);
  });

  it("cancelada aparece no período mas não conta como visita da consultora", async () => {
    const v = await visit("2026-10-14T15:00:00Z");
    await cancelVisitByStaff(jasmin, v.id, { reasonId: (await cancelReason()).id }, NOW);
    const a = await rangeAgenda(jasmin, "2026-10-12", "2026-10-19");
    expect(a).toMatchObject({ total: 1, canceled: 1, byConsultant: [] });
  });
});

// ───────────────────────── Desfazer cancelamento ─────────────────────────
describe("desfazer o cancelamento do pré-atendimento", () => {
  const setup = async () => {
    const { undoStaffCancel } = await import("@/server/visits");
    await makeConnection("central@exemplo.test");
    const api = new MockCalendar();
    const title = "Visita clt - Cliente Exemplo 1234567 - cod 111111;222222 - 51 99876-5432";
    api.put(visitEvent("u1", { start: "2026-10-14T15:00:00Z", title, organizer: "central@exemplo.test" }));
    const sync = () => runSync({ api, now: NOW, sleep: async () => {} });
    await sync();
    const [a, b] = await db.visit.findMany({ orderBy: { createdAt: "asc" } });
    return { undoStaffCancel, api, sync, title, a, b, r: await cancelReason() };
  };

  it("cancelou tudo por engano: volta no app e o evento volta no Google, sem conflito", async () => {
    const { undoStaffCancel, api, sync, a, r } = await setup();
    const c = await cancelVisitByStaff(jasmin, a.id, { reasonId: r.id }, NOW, { calendarApi: api });
    expect(c.google).toBe("canceled");
    const u = await undoStaffCancel(jasmin, c.undoId, new Date(NOW.getTime() + 10_000), { calendarApi: api });
    expect(u).toEqual({ count: 2, google: "restored" });
    expect((await api.getEvent("central@exemplo.test", "u1"))?.status).toBe("confirmed");
    await sync();
    expect((await db.visit.findMany()).map((v) => [v.status, v.cancelReasonId, v.syncConflict])).toEqual([["SCHEDULED", null, "NONE"], ["SCHEDULED", null, "NONE"]]);
    // não desfaz duas vezes
    await expect(undoStaffCancel(jasmin, c.undoId, new Date(NOW.getTime() + 20_000), { calendarApi: api })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("cancelou um imóvel por engano: o código volta ao título", async () => {
    const { undoStaffCancel, api, title, a, r } = await setup();
    const c = await cancelVisitByStaff(jasmin, a.id, { reasonId: r.id, onlyThis: true }, NOW, { calendarApi: api });
    expect((await api.getEvent("central@exemplo.test", "u1"))?.summary).not.toContain("111111");
    expect((await undoStaffCancel(jasmin, c.undoId, NOW, { calendarApi: api })).google).toBe("title_back");
    expect((await api.getEvent("central@exemplo.test", "u1"))?.summary).toBe(title);
  });

  it("título editado à mão depois: não sobrescreve; passou do tempo: não desfaz; outra pessoa: não vê", async () => {
    const { undoStaffCancel, api, a, b, r } = await setup();
    const c = await cancelVisitByStaff(jasmin, a.id, { reasonId: r.id, onlyThis: true }, NOW, { calendarApi: api });
    const ev = (await api.getEvent("central@exemplo.test", "u1"))!;
    api.put({ ...ev, summary: `${ev.summary} - REAGENDADA` });
    expect((await undoStaffCancel(jasmin, c.undoId, NOW, { calendarApi: api })).google).toBe("title_changed");
    expect((await api.getEvent("central@exemplo.test", "u1"))?.summary).toContain("REAGENDADA");

    const c2 = await cancelVisitByStaff(jasmin, b.id, { reasonId: r.id }, NOW, { calendarApi: api });
    const other = { id: (await db.user.create({ data: { name: "Outra Pré", email: "outra@exemplo.test", role: "PRE_SERVICE" } })).id, role: "PRE_SERVICE" as const };
    await expect(undoStaffCancel(other, c2.undoId, NOW, { calendarApi: api })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(undoStaffCancel(jasmin, c2.undoId, new Date(Date.now() + 3 * 60_000), { calendarApi: api })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

// ───────────────────────── Evento criado pelo app ─────────────────────────
describe("o app cria o evento no Google", () => {
  it("reagendar cria o evento com título, convidados e código; a sincronização liga sem duplicar (vários imóveis)", async () => {
    const { rescheduleVisit, createVisitEventInGoogle } = await import("@/server/reschedule");
    await makeConnection("central@exemplo.test");
    await db.appSettings.update({ where: { id: 1 }, data: { calendarCcEmails: "central@exemplo.test, gestora@exemplo.test" } });
    const api = new MockCalendar();
    const old = await visit("2026-10-13T13:00:00Z");
    const nv = await rescheduleVisit(u.a, old.id, { requestId: "bateria-ev-1", scheduledStart: toLocalInput(new Date("2026-10-15T17:00:00Z")), durationMinutes: 60, mode: "reschedule", propertyCode: "761739;888888" }, NOW);
    expect(await createVisitEventInGoogle(u.a, nv.id, { calendarApi: api })).toBe("created");
    const ev = (await api.getEvent("central@exemplo.test", "app-1"))!;
    expect(ev.summary).toBe("Visita clt - Cliente Bateria - cod 761739;888888 - (51) 99876-7777 - REAGENDADA");
    expect(ev.description).toContain(nv.linkCode!);
    expect((ev.attendees ?? []).map((a) => a.email).sort()).toEqual(["central@exemplo.test", "consultora.a@exemplo.test", "gestora@exemplo.test"]);
    expect((await db.visit.findUniqueOrThrow({ where: { id: nv.id } })).googleCreatedAt).not.toBeNull();
    // não cria duas vezes
    expect(await createVisitEventInGoogle(u.a, nv.id, { calendarApi: api })).toBe("already");
    await runSync({ api, now: NOW, sleep: async () => {} });
    const group = await db.visit.findMany({ where: { OR: [{ id: nv.id }, { companionOfId: nv.id }] }, orderBy: { createdAt: "asc" } });
    expect(group.map((v) => [v.propertyCode, v.status, v.consultantId === u.a.id])).toEqual([["761739", "SCHEDULED", true], ["888888", "SCHEDULED", true]]);
    expect(group[0].sourceEventId).not.toBeNull();
    expect(await db.visit.count({ where: { status: "SCHEDULED" } })).toBe(2); // nada duplicado
  });

  it("sem permissão de edição: não cria e a tela mostra o botão", async () => {
    const { rescheduleVisit, createVisitEventInGoogle } = await import("@/server/reschedule");
    await makeConnection("central@exemplo.test"); // conexão de teste só com leitura
    const old = await visit("2026-10-13T13:00:00Z");
    const nv = await rescheduleVisit(u.a, old.id, { requestId: "bateria-ev-2", scheduledStart: toLocalInput(new Date("2026-10-15T17:00:00Z")), durationMinutes: 60, mode: "reschedule" }, NOW);
    expect(await createVisitEventInGoogle(u.a, nv.id)).toBe("no_permission");
    await expect(createVisitEventInGoogle(u.b, nv.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ───────────────────────── Pendente com lista do que falta ─────────────────────────
describe("pré-análise pendente com o que falta", () => {
  it("salva a lista, avisa e volta para a consultora quando o pré-atendimento anexa", async () => {
    const { resolvePreAnalysis } = await import("@/server/pre-analysis");
    const p = await createPreAnalysis(jasmin, { consultantId: u.a.id }, NOW);
    const renda = await db.reason.findFirstOrThrow({ where: { kind: "PRE_MISSING", label: "Comprovante de renda" } });
    const outro = await db.reason.findFirstOrThrow({ where: { kind: "PRE_MISSING", label: "Outro" } });
    await expect(resolvePreAnalysis(u.a, p.id, { status: "PENDING", note: "" }, NOW)).rejects.toMatchObject({ code: "VALIDATION", details: { missing: expect.any(String) } });
    await expect(resolvePreAnalysis(u.a, p.id, { status: "PENDING", note: "", missingIds: [outro.id] }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    await resolvePreAnalysis(u.a, p.id, { status: "PENDING", note: "", missingIds: [renda.id] }, NOW);
    expect(await db.preAnalysis.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "PENDING", missingItems: ["Comprovante de renda"] });
    // a consultora anexa algo: continua pendente
    expect((await addPreAnalysisFiles(u.a, p.id, [pdf("anotacao.pdf")])).resubmitted).toBe(false);
    // o pré-atendimento anexa o que faltava: volta para análise
    expect((await addPreAnalysisFiles(jasmin, p.id, [pdf("renda.pdf")])).resubmitted).toBe(true);
    expect(await db.preAnalysis.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "AWAITING", missingItems: ["Comprovante de renda"] });
    // aprovação limpa a lista
    await resolvePreAnalysis(u.a, p.id, { status: "APPROVED", note: "aprovado" }, NOW);
    expect((await db.preAnalysis.findUniqueOrThrow({ where: { id: p.id } })).missingItems).toEqual([]);
  });
});

// ───────────────────────── Mensagens de depois da visita ─────────────────────────
describe("mensagens prontas de depois da visita", () => {
  it("texto e rótulo certos para cada resultado; sem telefone não oferece", async () => {
    const { afterVisitLink } = await import("@/lib/after-visit");
    const s = await db.appSettings.findUniqueOrThrow({ where: { id: 1 } });
    const base = { phoneNormalized: "+5551998767777", clientName: "Ana Souza", propertyCode: "761739", scheduledStart: NOW, consultant: { name: "Eduarda Schuler" }, property: { neighborhood: "Igara" } };
    const pos = afterVisitLink(s, { ...base, status: "DONE", evaluation: "POSITIVE" })!;
    expect(pos.label).toBe("Pedir documentos");
    expect(pos.text).toContain("Olá, Ana! Aqui é Eduarda");
    expect(pos.text).toContain("comprovante de renda");
    expect(pos.url).toMatch(/^https:\/\/wa\.me\/5551998767777\?text=/);
    expect(afterVisitLink(s, { ...base, status: "DONE", evaluation: "UNDECIDED" })!.label).toBe("Mensagem de retorno");
    expect(afterVisitLink(s, { ...base, status: "DONE", evaluation: "NEGATIVE" })!.label).toBe("Oferecer outras opções");
    expect(afterVisitLink(s, { ...base, status: "NO_SHOW", evaluation: null })!.label).toBe("Propor remarcar");
    expect(afterVisitLink(s, { ...base, status: "CANCELED", evaluation: null })).toBeNull();
    expect(afterVisitLink(s, { ...base, phoneNormalized: null, status: "DONE", evaluation: "POSITIVE" })).toBeNull();
  });
});

// ───────────────────────── Jasmin agenda pelo app + edições vão para o Google ─────────────────────────
describe("agenda nos dois sentidos", () => {
  const ready = async () => {
    await makeConnection("central@exemplo.test");
    await db.appSettings.update({ where: { id: 1 }, data: { calendarCcEmails: "" } });
    const api = new MockCalendar();
    const sync = () => runSync({ api, now: NOW, sleep: async () => {} });
    return { api, sync };
  };
  const input = (o: Record<string, unknown> = {}) => ({ requestId: `staff-${++seq}`, clientName: "Ana Souza", externalRef: "2864969", phoneRaw: "51 9348-4750", propertyCodes: "111111;222222", consultantId: u.a.id, scheduledStart: toLocalInput(new Date("2026-10-15T17:00:00Z")), durationMinutes: 60, ...o });

  it("Jasmin agenda: visita + imóveis + evento no padrão; sincronização liga sem duplicar", async () => {
    const { createStaffVisit } = await import("@/server/staff-visit");
    const { api, sync } = await ready();
    await expect(createStaffVisit(u.a, input(), NOW, { calendarApi: api })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createStaffVisit(jasmin, input({ clientName: "", propertyCodes: "" }), NOW, { calendarApi: api })).rejects.toMatchObject({ code: "VALIDATION", details: { clientName: expect.any(String), propertyCodes: expect.any(String) } });
    const i = input();
    const r = await createStaffVisit(jasmin, i, NOW, { calendarApi: api });
    expect(r.google).toBe("created");
    expect((await createStaffVisit(jasmin, i, NOW, { calendarApi: api })).visit.id).toBe(r.visit.id); // toque duplo
    const ev = (await api.getEvent("central@exemplo.test", "app-1"))!;
    expect(ev.summary).toBe("Visita clt - Ana Souza 2864969 - cod 111111;222222 - 51 9348-4750");
    expect((ev.attendees ?? []).map((a) => a.email)).toContain("consultora.a@exemplo.test");
    await sync();
    const all = await db.visit.findMany({ orderBy: { createdAt: "asc" } });
    expect(all.map((v) => [v.propertyCode, v.consultantId === u.a.id, v.phoneNormalized, v.externalRef])).toEqual([
      ["111111", true, "+5551993484750", "2864969"],
      ["222222", true, "+5551993484750", "2864969"],
    ]);
    expect(all[0].sourceEventId).not.toBeNull();
    // título lido de volta igual ao que o app escreveu: nada de conflito nem cartão extra
    expect(all.every((v) => v.syncConflict === "NONE")).toBe(true);
  });

  it("horário corrigido no app move o evento (também visita vinda da agenda); acompanhante não muda sozinha", async () => {
    const { correctVisitData } = await import("@/server/visits");
    const { api, sync } = await ready();
    api.put(visitEvent("g1", { start: "2026-10-15T13:00:00Z", title: "Visita clt - Cliente Exemplo 1234567 - cod 111111;222222 - 51 99876-5432", organizer: "central@exemplo.test" }));
    await sync();
    const [main, comp] = await db.visit.findMany({ orderBy: { createdAt: "asc" } });
    await expect(correctVisitData(u.manager, comp.id, { expectedVersion: comp.version, scheduledStart: toLocalInput(new Date("2026-10-15T18:00:00Z")) }, { calendarApi: api })).rejects.toMatchObject({ code: "VALIDATION" });
    await correctVisitData(u.manager, main.id, { expectedVersion: main.version, scheduledStart: toLocalInput(new Date("2026-10-15T18:00:00Z")), scheduledEnd: toLocalInput(new Date("2026-10-15T19:00:00Z")) }, { calendarApi: api });
    expect((await api.getEvent("central@exemplo.test", "g1"))?.start?.dateTime).toBe("2026-10-15T18:00:00.000Z");
    await sync();
    const after = await db.visit.findMany({ orderBy: { createdAt: "asc" } });
    expect(after.map((v) => v.scheduledStart.toISOString())).toEqual(["2026-10-15T18:00:00.000Z", "2026-10-15T18:00:00.000Z"]); // a acompanhante segue o evento
    expect(after.every((v) => v.syncConflict === "NONE")).toBe(true);
  });

  it("evento de outra pessoa: o horário não muda e o app avisa", async () => {
    const { correctVisitData } = await import("@/server/visits");
    const { api, sync } = await ready();
    api.put(visitEvent("g2", { start: "2026-10-15T13:00:00Z", organizer: "consultora.a@exemplo.test" }));
    await sync();
    const v = await db.visit.findFirstOrThrow();
    await expect(correctVisitData(u.manager, v.id, { expectedVersion: v.version, scheduledStart: toLocalInput(new Date("2026-10-15T18:00:00Z")), scheduledEnd: toLocalInput(new Date("2026-10-15T19:00:00Z")) }, { calendarApi: api })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).scheduledStart.toISOString()).toBe("2026-10-15T13:00:00.000Z");
  });

  it("gestão troca a consultora: o convite muda no evento; remarcar tira o evento antigo", async () => {
    const { assignVisit } = await import("@/server/visits");
    const { cancelOldEvent } = await import("@/server/google-write");
    const { api, sync } = await ready();
    api.put(visitEvent("g3", { start: "2026-10-15T13:00:00Z", organizer: "central@exemplo.test" }));
    await sync();
    const v = await db.visit.findFirstOrThrow();
    expect(await assignVisit(u.manager, v.id, u.b.id, "troca", { calendarApi: api })).toBe("updated");
    const emails = ((await api.getEvent("central@exemplo.test", "g3"))?.attendees ?? []).map((a) => a.email);
    expect(emails).toContain("consultora.b@exemplo.test");
    expect(emails).not.toContain("consultora.a@exemplo.test");
    await sync();
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).consultantId).toBe(u.b.id); // atribuição manual mantida
    expect(await cancelOldEvent(v.id, api)).toBe("canceled");
    expect((await api.getEvent("central@exemplo.test", "g3"))?.status).toBe("cancelled");
  });
});
