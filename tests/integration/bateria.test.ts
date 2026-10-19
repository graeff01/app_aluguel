// Bateria de casos de borda das funcionalidades de 14–15/10 (documentos, pré-análise sem obrigatórios, rodízio,
// cancelamento parcial/Google, vários imóveis, marketing, telefone, leitura do título, agenda semana/mês).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { classifyTitle, DEFAULT_PATTERNS, parseVisitEvent, removeCodeFromTitle } from "@/lib/parser";
import { assignmentQueue, createPreAnalysis, runPreAnalysisRetention } from "@/server/pre-analysis";
import { addPreAnalysisFiles, readFiles, readPreAnalysisFile, MAX_FILE_BYTES } from "@/server/pre-analysis-files";
import { cancelVisitByStaff, concludeVisit, createManualVisit, setCancelReason } from "@/server/visits";
import { markLeasePosted, updateOpportunity } from "@/server/opportunities";
import { rangeAgenda } from "@/server/day-agenda";
import { preServiceDashboard } from "@/server/pre-service-dashboard";
import { captureLeasePhotosNow, captureMissingLeasePhotos, leasePhotosZip, readLeasePhoto, siteDomain } from "@/server/lease-photos";
import { refreshPropertyPreviews } from "@/server/property-preview";
import { createMirrorEvent, deleteMirrorEvent, editMirrorEvent, loadMirror, moveMirrorEvent } from "@/server/calendar-mirror";
import type { CalendarApi } from "@/server/sync/types";
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
    // o restante → o evento é da consultora: não dá para mover para as 22h (ela é avisada) e nada é apagado
    expect((await cancelVisitByStaff(jasmin, (await byCode("222222")).id, { reasonId: r.id }, NOW, { calendarApi: api })).google).toBe("move_not_owner");
    expect((await api.getEvent("central@exemplo.test", "e1"))?.status).not.toBe("cancelled");

    // Google fora do ar: a visita fica cancelada no app mesmo assim
    const v3 = await byCode("444444");
    const broken = { patchEvent: async () => Promise.reject(Object.assign(new Error("Google fora"), { kind: "RETRYABLE" })) } as unknown as MockCalendar;
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

  it("cancelou tudo: o evento vai para as 22h (não some); por engano: volta ao horário, sem conflito", async () => {
    const { undoStaffCancel, api, sync, a, r } = await setup();
    const c = await cancelVisitByStaff(jasmin, a.id, { reasonId: r.id }, NOW, { calendarApi: api });
    expect(c.google).toBe("moved");
    // 14/10 12h (Brasília) → 14/10 22h, mesma duração; continua na agenda
    const night = (await api.getEvent("central@exemplo.test", "u1"))!;
    expect(night.status).not.toBe("cancelled");
    expect([night.start?.dateTime, night.end?.dateTime]).toEqual(["2026-10-15T01:00:00.000Z", "2026-10-15T02:00:00.000Z"]);
    // a sincronização vê o evento às 22h: as visitas continuam canceladas com o motivo e no horário original
    await sync();
    expect((await db.visit.findMany()).map((v) => [v.status, !!v.cancelReasonId, v.scheduledStart.toISOString(), v.syncConflict])).toEqual([
      ["CANCELED", true, "2026-10-14T15:00:00.000Z", "NONE"],
      ["CANCELED", true, "2026-10-14T15:00:00.000Z", "NONE"],
    ]);
    const u = await undoStaffCancel(jasmin, c.undoId, new Date(NOW.getTime() + 10_000), { calendarApi: api });
    expect(u).toEqual({ count: 2, google: "time_back" });
    expect((await api.getEvent("central@exemplo.test", "u1"))?.start?.dateTime).toBe("2026-10-14T15:00:00.000Z");
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

// ───────────────────────── Fluxo pós-visita (situações até a posse) ─────────────────────────
describe("fluxo pós-visita", () => {
  const ready = async () => {
    const v = await visit("2026-10-10T13:00:00Z");
    await concludeVisit(u.a, v.id, { requestId: `bateria-fluxo-${++seq}`, expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "quer seguir" }, NOW);
    return db.opportunity.findFirstOrThrow();
  };
  const ver = async (id: string) => (await db.opportunity.findUniqueOrThrow({ where: { id } })).version;
  const gid = async (label: string) => (await db.reason.findFirstOrThrow({ where: { kind: "GUARANTEE", label } })).id;

  it("caminho completo até a posse: dados de cada etapa, data de cada mudança, VGL e marketing", async () => {
    const { moveDealStage, dealFunnel } = await import("@/server/deal-flow");
    const o = await ready();
    expect(o.stage).toBeNull(); // em acompanhamento até a consultora registrar a negociação
    const go = async (input: Record<string, unknown>) => moveDealStage(u.a, o.id, { expectedVersion: await ver(o.id), ...input } as never, NOW);
    await expect(go({ to: "NEGOTIATION" })).rejects.toMatchObject({ code: "VALIDATION", details: { proposedRent: expect.any(String), intendedGuarantee: expect.any(String) } });
    await go({ to: "NEGOTIATION", proposedRent: "2.300,00", intendedGuarantee: await gid("Seguro fiança") });
    await go({ to: "OWNER_PENDING", proposalSentAt: "2026-10-11" });
    await expect(go({ to: "KYC_SENT", ownerAcceptedAt: "2026-10-12", agreedRent: "2.200", kycSentAt: "2026-10-12", kycDueAt: "2026-10-10" })).rejects.toMatchObject({ details: { kycDueAt: expect.any(String) } });
    await go({ to: "KYC_SENT", ownerAcceptedAt: "2026-10-12", agreedRent: "2.200", kycSentAt: "2026-10-12", kycDueAt: "2026-10-15" });
    await go({ to: "ANALYSIS" });
    const renda = await db.reason.findFirstOrThrow({ where: { kind: "PRE_MISSING", label: "Comprovante de renda" } });
    await go({ to: "DOCS", guarantee: await gid("CredPago"), analysisDecidedAt: "2026-10-13", docsRequestedAt: "2026-10-13", docsMissingIds: [renda.id] });
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("DOCS_REVIEW"); // indicadores de sempre acompanham
    await go({ to: "CONTRACT", contractReleasedAt: "2026-10-13", inspectionNeeded: "sim" });
    await expect(go({ to: "SIGNED", signedAt: "2026-10-13", dealType: "LEASE", contractValue: "2.200,00" })).rejects.toMatchObject({ details: { agentId: expect.any(String), highlightNote: expect.any(String) } });
    await go({ to: "SIGNED", signedAt: "2026-10-13", dealType: "LEASE", contractValue: "2.200,00", ...(await leaseInfo()) });
    await expect(go({ to: "POSSESSION", possessionAt: "2026-10-13" })).rejects.toMatchObject({ details: { keysHolderChecked: expect.any(String) } });
    await go({ to: "POSSESSION", possessionAt: "2026-10-13", keysHolderChecked: true });

    const done = await db.opportunity.findUniqueOrThrow({ where: { id: o.id }, include: { events: { orderBy: { createdAt: "asc" } } } });
    expect(done).toMatchObject({ stage: "POSSESSION", status: "CLOSED_WON", proposedRentCents: 230000, agreedRentCents: 220000, guarantee: "CredPago", intendedGuarantee: "Seguro fiança", docsMissing: ["Comprovante de renda"], contractValueCents: 220000, dealType: "LEASE", keysHolderChecked: true });
    expect(done.events.map((e) => e.toStage).filter(Boolean)).toEqual(["NEGOTIATION", "OWNER_PENDING", "KYC_SENT", "ANALYSIS", "DOCS", "CONTRACT", "SIGNED", "POSSESSION"]);
    expect(await db.leasePost.count({ where: { opportunityId: o.id } })).toBe(1); // marketing avisado no contrato assinado
    const f = await dealFunnel(u.manager, { from: new Date("2026-10-01T03:00:00Z"), to: new Date("2026-11-01T03:00:00Z") });
    expect(f.reached.find((r) => r.stage === "POSSESSION")?.count).toBe(1);
    expect(f.vgl).toMatchObject({ totalCents: 220000, contracts: 1, lease: 1 });
  });

  it("caiu: pede motivo e observação, registra a etapa; voltar a situação pede o porquê; consultora só mexe no que é dela", async () => {
    const { moveDealStage, dealFunnel } = await import("@/server/deal-flow");
    const o = await ready();
    await moveDealStage(u.a, o.id, { expectedVersion: await ver(o.id), to: "NEGOTIATION", proposedRent: "1.900", intendedGuarantee: await gid("Fiador") }, NOW);
    await moveDealStage(u.a, o.id, { expectedVersion: await ver(o.id), to: "OWNER_PENDING", proposalSentAt: "2026-10-12" }, NOW);
    await expect(moveDealStage(u.a, o.id, { expectedVersion: await ver(o.id), to: "NEGOTIATION", proposedRent: "1.800", intendedGuarantee: await gid("Fiador") }, NOW)).rejects.toMatchObject({ details: { note: expect.any(String) } });
    await expect(moveDealStage(u.b, o.id, { expectedVersion: await ver(o.id), to: "ANALYSIS" }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(moveDealStage(u.a, o.id, { expectedVersion: await ver(o.id), to: "FELL" }, NOW)).rejects.toMatchObject({ details: { lostReasonId: expect.any(String), note: expect.any(String) } });
    const r = await db.reason.findFirstOrThrow({ where: { kind: "OPPORTUNITY_LOST", label: "Desistiu da locação" } });
    await moveDealStage(u.a, o.id, { expectedVersion: await ver(o.id), to: "FELL", lostReasonId: r.id, note: "proprietário não aceitou o valor" }, NOW);
    expect(await db.opportunity.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "LOST", lostStage: "OWNER_PENDING", lostReasonId: r.id });
    const f = await dealFunnel(u.manager, { from: new Date("2026-10-01T03:00:00Z"), to: new Date("2026-11-01T03:00:00Z") });
    expect(f.reached.find((x) => x.stage === "OWNER_PENDING")?.lost).toBe(1);
    // gestão reabre (correção) com observação
    await moveDealStage(u.manager, o.id, { expectedVersion: await ver(o.id), to: "OWNER_PENDING", proposalSentAt: "2026-10-12", note: "voltou a negociar" }, NOW);
    expect(await db.opportunity.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "FOLLOW_UP", stage: "OWNER_PENDING", lostStage: null });
  });

  it("negócio parado na mesma situação: alerta para a consultora e para a gestão (uma vez por dia)", async () => {
    const { moveDealStage } = await import("@/server/deal-flow");
    const o = await ready();
    await moveDealStage(u.a, o.id, { expectedVersion: await ver(o.id), to: "NEGOTIATION", proposedRent: "1.900", intendedGuarantee: await gid("Fiador") }, NOW);
    await db.opportunity.update({ where: { id: o.id }, data: { stageChangedAt: new Date(NOW.getTime() - 10 * 24 * H) } });
    await db.pushSubscription.createMany({ data: [{ userId: u.a.id, endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, { userId: u.manager.id, endpoint: "https://push.test/m", p256dh: "k", auth: "a" }] });
    await db.appSettings.update({ where: { id: 1 }, data: { remindersEnabled: true } });
    const { sendOperationalAlerts } = await import("@/server/reminders");
    const sent: string[] = [];
    await sendOperationalAlerts(NOW, { send: async (_t, p) => (sent.push(p.title), "ok"), email: null });
    expect(sent).toContain("1 negócio parado há mais de 7 dias");
    expect(sent).toContain("Equipe: 1 negócio parado há mais de 7 dias");
    const again: string[] = [];
    await sendOperationalAlerts(new Date(NOW.getTime() + 60_000), { send: async (_t, p) => (again.push(p.title), "ok"), email: null });
    expect(again.filter((t) => /parado/.test(t))).toEqual([]);
  });
});

describe("motivo depois do cancelamento (caso Antonio, 16/10)", () => {
  it("imóveis retirados pela agenda e 'cliente cancelou' da consultora: o pré-atendimento informa o motivo depois", async () => {
    await makeConnection("central@exemplo.test");
    const api = new MockCalendar();
    const ev = (codes: string) => visitEvent("ant", { start: "2026-10-13T12:00:00Z", title: `Visita clt - Antonio Exemplo 2930024 - cod ${codes} - 51 99361-8788`, organizer: "central@exemplo.test" });
    api.put(ev("111111;222222;333333;444444"));
    const sync = () => runSync({ api, now: new Date("2026-10-13T10:00:00Z"), sleep: async () => {} });
    await sync();
    // Jasmin tira dois códigos do título: esses dois são cancelados pela sincronização, sem motivo da lista
    api.put(ev("111111;333333"));
    await sync();
    const byCode = (c: string) => db.visit.findFirstOrThrow({ where: { propertyCode: c }, include: { concludedBy: true } });
    const gone = await byCode("222222");
    expect(gone).toMatchObject({ status: "CANCELED", autoCanceled: true, cancelReasonId: null, concludedById: null });
    // a consultora registra "cliente cancelou" (vale para os dois imóveis restantes)
    const main = await byCode("111111");
    await concludeVisit(u.a, main.id, { requestId: "antonio-cancelou-1", expectedVersion: main.version, status: "CANCELED", note: "Cliente cancelou a visita.", applyToSameVisit: true }, NOW);
    expect((await byCode("333333")).status).toBe("CANCELED");

    const r = await cancelReason();
    await expect(setCancelReason(u.a, main.id, { reasonId: r.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setCancelReason(jasmin, main.id, { reasonId: (await cancelReason("Outro")).id })).rejects.toMatchObject({ code: "VALIDATION" });
    // um motivo vale para os imóveis cancelados juntos; o texto da consultora é mantido
    expect(await setCancelReason(jasmin, main.id, { reasonId: r.id })).toEqual({ count: 2 });
    for (const c of ["111111", "333333"]) expect(await byCode(c)).toMatchObject({ cancelReasonId: r.id, note: "Cliente desistiu — Cliente cancelou a visita." });
    expect((await byCode("222222")).cancelReasonId).toBeNull();
    await expect(setCancelReason(jasmin, main.id, { reasonId: r.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
    // imóveis retirados pela agenda: motivo separado (cancelados em outro momento)
    expect(await setCancelReason(jasmin, gone.id, { reasonId: r.id, note: "não quis mais esses" })).toEqual({ count: 2 });
    expect((await byCode("444444")).note).toBe("Cliente desistiu — não quis mais esses — Imóvel retirado do evento na agenda Google");
    // visita agendada não aceita
    const open = await visit("2026-10-15T15:00:00Z", "555555");
    await expect(setCancelReason(jasmin, open.id, { reasonId: r.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const hist = await db.visitOutcomeHistory.findMany({ where: { visitId: main.id }, orderBy: { createdAt: "asc" } });
    expect(hist.at(-1)).toMatchObject({ authorId: jasmin.id, note: "Motivo informado: Cliente desistiu — Cliente cancelou a visita." });
  });
});

describe("painel: visão do pré-atendimento", () => {
  it("conta as visitas dos eventos que ela organizou (e-mail de login ou apelido) e as pré-análises dela", async () => {
    await makeConnection("central@exemplo.test");
    const api = new MockCalendar();
    // agenda dela com outro e-mail (como jasmim/jasmin): cadastrado como apelido
    await db.userEmailAlias.create({ data: { userId: jasmin.id, email: "agenda.jasmin@exemplo.test" } });
    api.put(visitEvent("p1", { start: "2026-10-12T15:00:00Z", title: "Visita clt - Cliente Um 1111111 - cod 111111;222222 - 51 99876-0001", organizer: "agenda.jasmin@exemplo.test" }));
    api.put(visitEvent("p2", { start: "2026-10-12T18:00:00Z", title: "Visita clt - Cliente Dois 2222222 - cod 333333 - 51 99876-0002", organizer: "agenda.jasmin@exemplo.test" }));
    api.put(visitEvent("c1", { start: "2026-10-12T19:00:00Z", title: "Visita clt - Cliente Tres 3333333 - cod 444444 - 51 99876-0003", organizer: "consultora.a@exemplo.test" }));
    await runSync({ api, now: new Date("2026-10-12T10:00:00Z"), sleep: async () => {} });
    const one = await db.visit.findFirstOrThrow({ where: { propertyCode: "111111" } });
    await concludeVisit(u.a, one.id, { requestId: "pre-painel-1", expectedVersion: one.version, status: "DONE", evaluation: "POSITIVE", note: "gostou" }, NOW);
    const two = await db.visit.findFirstOrThrow({ where: { propertyCode: "333333" } });
    await concludeVisit(u.a, two.id, { requestId: "pre-painel-2", expectedVersion: two.version, status: "NO_SHOW", note: "não veio" }, NOW);

    await expect(preServiceDashboard(u.a, jasmin.id, "2026-10-01", "2026-10-31", NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await preServiceDashboard(u.admin, u.a.id, "2026-10-01", "2026-10-31", NOW)).toBeNull(); // só pré-atendimento
    const d = (await preServiceDashboard(u.admin, jasmin.id, "2026-10-01", "2026-10-31", NOW))!;
    // 3 imóveis (2 atendimentos); o evento da consultora não entra
    expect(d.visits).toMatchObject({ total: 3, clients: 2, done: 1, positive: 1, noShow: 1, awaiting: 1, attendance: 0.5 });
    expect(d.emails).toContain("agenda.jasmin@exemplo.test");
    expect(d.pre.total).toBe(0);
    // fora do período: nada
    expect((await preServiceDashboard(u.admin, jasmin.id, "2026-09-01", "2026-09-30", NOW))!.visits.total).toBe(0);
  });
});

describe("marketing: fotos do anúncio guardadas na locação", () => {
  const jpg = (n: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n, 0xff, 0xd9]);
  const page = (imgs: string[]) =>
    `<html><head><meta property="og:title" content="Apartamento para alugar em Igara, Canoas."><meta property="og:image" content="${imgs[0]}"><script type="application/ld+json">${JSON.stringify({ offers: [{ price: 1800, itemOffered: { name: "Apartamento - Igara - Canoas", image: imgs } }] })}</script></head></html>`;
  const site = (routes: Record<string, () => Response>) =>
    (async (url: string | URL | Request) => {
      const r = routes[String(url)];
      return r ? r() : new Response("", { status: 404 });
    }) as typeof fetch;

  it("ao assinar, guarda todas as fotos (só do site), baixa uma ou todas em .zip e mantém depois que o anúncio sai", async () => {
    await db.appSettings.update({ where: { id: 1 }, data: { propertyUrlTemplate: "https://www.imoveis.test.br/imovel/{codigo}" } });
    expect(siteDomain("https://www.auxiliadorapredial.com.br/imovel/aluguel/{codigo}?tag=8086")).toBe("auxiliadorapredial.com.br");
    const v = await visit("2026-10-10T13:00:00Z", "777777");
    await concludeVisit(u.a, v.id, { requestId: `bateria-fotos-${++seq}`, expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "gostou" }, NOW);
    const o = await db.opportunity.findFirstOrThrow();
    await updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "CLOSED_WON", closedAt: "2026-10-12", ...(await leaseInfo()) });
    const post = await db.leasePost.findFirstOrThrow();

    const imgs = Array.from({ length: 12 }, (_, i) => `https://fotos.imoveis.test.br/777777/${i + 1}.jpg`);
    const all = [...imgs, "https://outro-site.test/espiao.jpg"];
    let online = true;
    let failSecond = true;
    const routes: Record<string, () => Response> = {
      "https://www.imoveis.test.br/imovel/777777": () => (online ? new Response(page(all), { status: 200, headers: { "content-type": "text/html" } }) : new Response("", { status: 404 })),
      "https://outro-site.test/espiao.jpg": () => new Response(jpg(99), { status: 200, headers: { "content-type": "image/jpeg" } }),
    };
    imgs.forEach((u, i) => {
      routes[u] = () => {
        if (i === 1 && failSecond) return new Response("", { status: 503 });
        return new Response(jpg(i), { status: 200, headers: { "content-type": "image/jpeg" } });
      };
    });
    const f = site(routes);

    // worker: 11 de 12 (uma falhou) — outro domínio nunca é baixado
    expect(await captureMissingLeasePhotos({ fetchImpl: f, now: NOW })).toEqual({ checked: 1 });
    expect(await db.leasePhoto.count()).toBe(11);
    expect(await db.leasePost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ photosStatus: "ERROR", photoAttempts: 1 });
    // antes de 1 h o worker não tenta de novo; a pessoa pode pedir na hora
    expect((await captureMissingLeasePhotos({ fetchImpl: f, now: new Date(NOW.getTime() + 60_000) })).checked).toBe(0);
    failSecond = false;
    await expect(captureLeasePhotosNow(u.a, post.id, { fetchImpl: f })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await captureLeasePhotosNow(mkt, post.id, { fetchImpl: f })).toMatchObject({ saved: 1, total: 12, status: "OK" });

    // baixar uma: nome com o código e a ordem do anúncio
    const second = await db.leasePhoto.findFirstOrThrow({ where: { position: 1 } });
    expect(await readLeasePhoto(mkt, second.id)).toMatchObject({ name: "imovel-777777-02.jpg", mime: "image/jpeg" });
    await expect(readLeasePhoto(u.a, second.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // baixar todas: .zip com as 12, na ordem
    const z = await leasePhotosZip(u.manager, post.id);
    expect(z.name).toBe("fotos-imovel-777777.zip");
    expect(z.data.readUInt32LE(0)).toBe(0x04034b50);
    const eocd = z.data.subarray(z.data.length - 22);
    expect(eocd.readUInt32LE(0)).toBe(0x06054b50);
    expect(eocd.readUInt16LE(10)).toBe(12);
    expect(z.data.includes(Buffer.from("imovel-777777-01.jpg"))).toBe(true);
    expect(z.data.includes(Buffer.from("imovel-777777-12.jpg"))).toBe(true);

    // alugado: o anúncio sai do site → as fotos e os links continuam
    online = false;
    await db.property.update({ where: { code: "777777" }, data: { pageCheckedAt: new Date(Date.now() - 30 * 86400_000) } });
    await refreshPropertyPreviews({ fetchImpl: f, pauseMs: 0 });
    const prop = await db.property.findUniqueOrThrow({ where: { code: "777777" } });
    expect(prop.pageStatus).toBe("NOT_FOUND");
    expect(prop.gallery).toHaveLength(13);
    expect(prop.photos).toHaveLength(8);
    expect(prop.photoUrl).toBe(imgs[0]);
    expect(await db.leasePhoto.count({ where: { leasePostId: post.id } })).toBe(12);
  });
});

describe("Agenda Google dentro do app (espelho do pré-atendimento)", () => {
  const FROM = new Date("2026-10-18T03:00:00Z");
  const TO = new Date("2026-10-25T03:00:00Z");
  const setup = async () => {
    await makeConnection("central@exemplo.test");
    const own = new MockCalendar();
    const shared = new MockCalendar();
    own.pageSize = 50;
    shared.pageSize = 50;
    own.put(visitEvent("vis", { start: "2026-10-20T13:00:00Z", title: "Visita clt - Cliente Espelho 1234567 - cod 111111;222222 - 51 99876-5432", organizer: "central@exemplo.test" }));
    own.put({ id: "almoco", summary: "almoço", colorId: "11", start: { dateTime: "2026-10-20T14:30:00Z" }, end: { dateTime: "2026-10-20T15:30:00Z" }, organizer: { email: "central@exemplo.test" }, htmlLink: "https://calendar.google.com/x" });
    own.put({ id: "plantao", summary: "Plantao do Dia - Tami", start: { date: "2026-10-20" }, end: { date: "2026-10-21" }, organizer: { email: "central@exemplo.test" } });
    own.put({ id: "convite", summary: "Reunião Q", start: { dateTime: "2026-10-19T17:30:00Z" }, end: { dateTime: "2026-10-19T18:30:00Z" }, organizer: { email: "vitoria@exemplo.test" }, attendees: [{ email: "central@exemplo.test", self: true, responseStatus: "accepted" }] });
    own.put({ id: "apagado", summary: "x", start: { dateTime: "2026-10-21T12:00:00Z" }, end: { dateTime: "2026-10-21T13:00:00Z" } });
    own.cancel("apagado");
    shared.put({ id: "vit", summary: "1:1 — Jasmine", start: { dateTime: "2026-10-22T12:30:00Z" }, end: { dateTime: "2026-10-22T13:00:00Z" }, organizer: { email: "vitoria@exemplo.test" } });
    await runSync({ api: own, now: new Date("2026-10-19T10:00:00Z"), sleep: async () => {} });
    const api: CalendarApi = {
      listCalendars: async () => [
        { id: "central@exemplo.test", summary: "central", accessRole: "owner", primary: true, backgroundColor: "#039be5", selected: true },
        { id: "vitoria@exemplo.test", summary: "vitoria souza", accessRole: "reader", backgroundColor: "#d50000", selected: true },
      ],
      listEvents: (q) => (q.calendarId === "vitoria@exemplo.test" ? shared : own).listEvents(q),
      getEvent: own.getEvent.bind(own),
      cancelEvent: own.cancelEvent.bind(own),
      updateSummary: own.updateSummary.bind(own),
      insertEvent: own.insertEvent.bind(own),
      patchEvent: own.patchEvent.bind(own),
      restoreEvent: own.restoreEvent.bind(own),
    };
    return { own, api };
  };

  it("mostra todas as agendas da conta (próprias e compartilhadas), com visitas ligadas ao app", async () => {
    expect((await loadMirror(jasmin, FROM, TO)).status).toBe("no_connection");
    const { api } = await setup();
    await expect(loadMirror(u.a, FROM, TO, { calendarApi: api })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(loadMirror(u.manager, FROM, TO, { calendarApi: api })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const m = await loadMirror(jasmin, FROM, TO, { calendarApi: api });
    if (m.status !== "ok") throw new Error(m.status);
    expect(m.calendars.map((c) => [c.name, c.canWrite])).toEqual([["agenda.central@exemplo.test", true], ["vitoria souza", false]]);
    const by = (id: string) => m.events.find((e) => e.id === id)!;
    expect(m.events.map((e) => e.id).sort()).toEqual(["almoco", "convite", "plantao", "vis", "vit"]);
    expect(by("vis").visit).toMatchObject({ status: "SCHEDULED", consultant: "Consultora A", codes: ["111111", "222222"], openCodes: ["111111", "222222"] });
    expect(by("vis").canEdit).toBe(true);
    expect(by("almoco")).toMatchObject({ title: "almoço", color: "#d50000", visit: null, canEdit: true, htmlLink: "https://calendar.google.com/x" });
    expect(by("plantao")).toMatchObject({ allDay: true, startDay: "2026-10-20", endDay: "2026-10-21" });
    expect(by("convite").canEdit).toBe(false); // convite de outra pessoa
    expect(by("vit")).toMatchObject({ calendarId: "vitoria@exemplo.test", canEdit: false, color: "#d50000" });
    expect((await loadMirror(u.admin, FROM, TO, { calendarApi: api })).status).toBe("ok");
  });

  it("mover, criar, editar e excluir vão para o Google; visita e evento dos outros têm proteção", async () => {
    const { own, api } = await setup();
    const o = { calendarApi: api };
    // arrastar a visita: muda no Google e pede sincronização (o app acompanha)
    await moveMirrorEvent(jasmin, { calendarId: "central@exemplo.test", eventId: "vis", start: "2026-10-20T16:00:00.000Z", end: "2026-10-20T17:00:00.000Z" }, o);
    expect((await own.getEvent("central@exemplo.test", "vis"))?.start?.dateTime).toBe("2026-10-20T16:00:00.000Z");
    expect(await db.syncRun.count({ where: { trigger: "MANUAL" } })).toBe(1);
    await expect(moveMirrorEvent(jasmin, { calendarId: "central@exemplo.test", eventId: "convite", start: "2026-10-19T18:00:00Z", end: "2026-10-19T19:00:00Z" }, o)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(moveMirrorEvent(jasmin, { calendarId: "vitoria@exemplo.test", eventId: "vit", start: "2026-10-22T13:00:00Z", end: "2026-10-22T14:00:00Z" }, o)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(moveMirrorEvent(jasmin, { calendarId: "central@exemplo.test", eventId: "almoco", start: "2026-10-20T16:00:00Z", end: "2026-10-20T15:00:00Z" }, o)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(moveMirrorEvent(u.a, { calendarId: "central@exemplo.test", eventId: "almoco", start: "2026-10-20T16:00:00Z", end: "2026-10-20T17:00:00Z" }, o)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // dia inteiro: muda o dia
    await moveMirrorEvent(jasmin, { calendarId: "central@exemplo.test", eventId: "plantao", startDay: "2026-10-21", endDay: "2026-10-22" }, o);
    expect((await own.getEvent("central@exemplo.test", "plantao"))?.start?.date).toBe("2026-10-21");

    // criar evento comum (com horário e de dia inteiro)
    const r1 = await createMirrorEvent(jasmin, { calendarId: "central@exemplo.test", title: " Reunião de equipe ", start: "2026-10-21T13:00:00Z", end: "2026-10-21T14:00:00Z" }, o);
    expect(await own.getEvent("central@exemplo.test", r1.id)).toMatchObject({ summary: "Reunião de equipe", start: { dateTime: "2026-10-21T13:00:00.000Z" } });
    const r2 = await createMirrorEvent(jasmin, { calendarId: "central@exemplo.test", title: "DAY OFF - Michele", startDay: "2026-10-21" }, o);
    expect((await own.getEvent("central@exemplo.test", r2.id))?.end?.date).toBe("2026-10-22");
    await expect(createMirrorEvent(jasmin, { calendarId: "central@exemplo.test", title: "  ", start: "2026-10-21T13:00:00Z", end: "2026-10-21T14:00:00Z" }, o)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createMirrorEvent(jasmin, { calendarId: "vitoria@exemplo.test", title: "x", start: "2026-10-21T13:00:00Z", end: "2026-10-21T14:00:00Z" }, o)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // editar: evento comum sim; visita pela ficha
    await editMirrorEvent(jasmin, { calendarId: "central@exemplo.test", eventId: "almoco", title: "Almoço", description: "sala 2" }, o);
    expect(await own.getEvent("central@exemplo.test", "almoco")).toMatchObject({ summary: "Almoço", description: "sala 2" });
    await expect(editMirrorEvent(jasmin, { calendarId: "central@exemplo.test", eventId: "vis", title: "outro" }, o)).rejects.toMatchObject({ code: "INVALID_STATE" });

    // excluir: evento comum sim; visita é cancelada com motivo; convite dos outros não
    await deleteMirrorEvent(jasmin, { calendarId: "central@exemplo.test", eventId: "almoco" }, o);
    expect((await own.getEvent("central@exemplo.test", "almoco"))?.status ?? "cancelled").toBe("cancelled");
    await expect(deleteMirrorEvent(jasmin, { calendarId: "central@exemplo.test", eventId: "vis" }, o)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(deleteMirrorEvent(jasmin, { calendarId: "central@exemplo.test", eventId: "convite" }, o)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: { startsWith: "calendar." } } })).toBe(6);
  });
});
