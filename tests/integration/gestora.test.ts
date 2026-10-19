// Pedidos da gestão: cancelamento pelo pré-atendimento, aviso de locação ao marketing e painel do pré-atendimento.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { cancelVisitByStaff, concludeVisit, createManualVisit } from "@/server/visits";
import { markLeasePosted, updateOpportunity } from "@/server/opportunities";
import { createPreAnalysis, preAnalysisStats, resolvePreAnalysis } from "@/server/pre-analysis";
import { toLocalInput } from "@/lib/time";
import { guaranteeId, leaseInfo, makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
let mkt: { id: string; role: "MARKETING" };
const NOW = new Date("2026-10-13T15:00:00Z");
let seq = 0;
const visit = (start: string, code = "761739") =>
  createManualVisit(u.admin, { requestId: `gestora-${++seq}-req`, scheduledStart: toLocalInput(new Date(start)), clientName: "Cliente Gestão", phoneRaw: "(51) 99876-4444", propertyCode: code, consultantId: u.a.id });
const cancelReason = (label = "Cliente desistiu") => db.reason.findFirstOrThrow({ where: { kind: "VISIT_CANCEL", label } });

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  jasmin = { id: (await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } })).id, role: "PRE_SERVICE" };
  mkt = { id: (await db.user.create({ data: { name: "Marketing", email: "mkt@exemplo.test", role: "MARKETING" } })).id, role: "MARKETING" };
});

describe("pré-atendimento cancela visita", () => {
  it("com motivo da lista; vale para os outros imóveis da mesma visita; consultora não usa esse caminho", async () => {
    const main = await visit("2026-10-14T15:00:00Z");
    const comp = await db.visit.create({ data: { origin: "MANUAL", companionOfId: main.id, scheduledStart: main.scheduledStart, scheduledEnd: main.scheduledEnd, propertyCode: "835840", consultantId: u.a.id, assignmentStatus: "MANUAL" } });
    const r = await cancelReason();
    await expect(cancelVisitByStaff(u.a, main.id, { reasonId: r.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const outro = await cancelReason("Outro");
    await expect(cancelVisitByStaff(jasmin, main.id, { reasonId: outro.id })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await cancelVisitByStaff(jasmin, main.id, { reasonId: r.id, note: "achou outro" }, NOW)).count).toBe(2);
    for (const id of [main.id, comp.id]) {
      expect(await db.visit.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "CANCELED", cancelReasonId: r.id, note: "Cliente desistiu — achou outro", concludedById: jasmin.id });
    }
    await expect(cancelVisitByStaff(jasmin, main.id, { reasonId: r.id })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("locação fechada → marketing", () => {
  const closeReady = async () => {
    const v = await visit("2026-10-10T13:00:00Z");
    await concludeVisit(u.a, v.id, { requestId: "g-done-1", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "gostou" }, NOW);
    return db.opportunity.findFirstOrThrow();
  };

  it("fechamento exige agenciador e diferencial, cria o aviso e reabrir antes de postar tira o aviso", async () => {
    const o = await closeReady();
    await expect(updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "CLOSED_WON", closedAt: "2026-10-12" })).rejects.toMatchObject({ code: "VALIDATION", details: { agentId: expect.any(String), highlightNote: expect.any(String) } });
    const h = await db.reason.findFirstOrThrow({ where: { kind: "LEASE_HIGHLIGHT", label: "Alugado na 1ª visita" } });
    await updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "CLOSED_WON", closedAt: "2026-10-12", highlightIds: [h.id], ...(await leaseInfo()) });
    const post = await db.leasePost.findUniqueOrThrow({ where: { opportunityId: o.id }, include: { agent: true } });
    expect(post).toMatchObject({ highlights: ["Alugado na 1ª visita"], highlightNote: "Fechou no mesmo dia da visita.", postedAt: null });
    expect(post.agent.label).toBe("Agenciador Teste");

    // reabriu antes de postar: o aviso some
    const closed = await db.opportunity.findUniqueOrThrow({ where: { id: o.id } });
    await updateOpportunity(u.manager, o.id, { expectedVersion: closed.version, toStatus: "FOLLOW_UP", note: "contrato não assinado" });
    expect(await db.leasePost.count()).toBe(0);
  });

  it("marketing marca como postado; consultora não", async () => {
    const o = await closeReady();
    await updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "CLOSED_WON", closedAt: "2026-10-12", ...(await leaseInfo()) });
    const post = await db.leasePost.findFirstOrThrow();
    await expect(markLeasePosted(u.a, post.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await markLeasePosted(mkt, post.id, true);
    expect(await db.leasePost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ postedById: mkt.id });
    expect((await db.leasePost.findUniqueOrThrow({ where: { id: post.id } })).postedAt).not.toBeNull();
  });
});

describe("pré-análise com garantia e painel do pré-atendimento", () => {
  it("painel separa por garantia e por quem enviou", async () => {
    const base = { fullName: "Maria Titular da Silva", birthDate: "1990-05-20", cpf: "529.982.247-25", email: "maria@exemplo.test", phone: "(51) 99876-1234", salary: "4.500,00", consultantId: u.a.id, propertyCode: "", note: "", holderConfirmed: true as const };
    const p1 = await createPreAnalysis(jasmin, { ...base, guaranteeId: await guaranteeId("CredPago") }, NOW);
    const p2 = await createPreAnalysis(jasmin, { ...base, cpf: "168.995.350-09", guaranteeId: await guaranteeId("Fiador") }, NOW);
    await resolvePreAnalysis(u.a, p1.id, { status: "APPROVED", note: "aprovado" }, NOW);
    await resolvePreAnalysis(u.a, p2.id, { status: "REJECTED", note: "renda" }, NOW);
    await expect(preAnalysisStats(u.a, new Date("2026-10-01T03:00:00Z"), new Date("2026-11-01T03:00:00Z"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const s = await preAnalysisStats(u.manager, new Date("2026-10-01T03:00:00Z"), new Date("2026-11-01T03:00:00Z"), { senderId: jasmin.id });
    expect(s).toMatchObject({ total: 2, approved: 1, rejected: 1 });
    expect(Object.fromEntries(s.byGuarantee.map(([k, c]) => [k, c.approved]))).toEqual({ CredPago: 1, Fiador: 0 });
    expect(s.bySender.map(([k]) => k)).toEqual(["Jasmin Pré"]);
    const other = await preAnalysisStats(u.manager, new Date("2026-10-01T03:00:00Z"), new Date("2026-11-01T03:00:00Z"), { senderId: u.manager.id });
    expect(other.total).toBe(0);
  });
});

describe("documentos da pré-análise e cadastro sem campos obrigatórios", () => {
  const pdf = (name = "rg.pdf", body = "%PDF-1.4\n% documento sintético\n") => new File([body], name, { type: "application/pdf" });
  const jpg = (name = "comprovante.jpg") => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])], name, { type: "image/jpeg" });

  it("envia só com a consultora; documentos ficam cifrados, só quem vê a pré-análise abre, e saem na retenção", async () => {
    const { readPreAnalysisFile, addPreAnalysisFiles, deletePreAnalysisFile } = await import("@/server/pre-analysis-files");
    const { runPreAnalysisRetention } = await import("@/server/pre-analysis");
    const p = await createPreAnalysis(jasmin, { consultantId: u.a.id }, NOW, [pdf(), jpg()]);
    expect(p).toMatchObject({ fullName: "", cpfEnc: null, cpfHash: null, incomeBand: "nao_informada", guaranteeId: null });
    const files = await db.preAnalysisFile.findMany({ where: { preAnalysisId: p.id }, orderBy: { createdAt: "asc" } });
    expect(files.map((f) => [f.name, f.mime])).toEqual([["rg.pdf", "application/pdf"], ["comprovante.jpg", "image/jpeg"]]);
    expect(Buffer.from(files[0].data).toString("latin1")).not.toContain("%PDF"); // cifrado no banco
    expect((await readPreAnalysisFile(u.a, p.id, files[0].id)).data.toString("latin1")).toContain("%PDF-1.4");
    await expect(readPreAnalysisFile(u.b, p.id, files[0].id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "preanalysis.file_viewed" } })).toBe(1);

    // não aceita arquivo que não é foto nem PDF (pelo conteúdo, não pelo nome)
    await expect(addPreAnalysisFiles(u.a, p.id, [new File(["MZ executavel"], "foto.jpg", { type: "image/jpeg" })])).rejects.toMatchObject({ code: "VALIDATION" });
    await addPreAnalysisFiles(u.a, p.id, [pdf("renda.pdf")]);
    // consultora não remove o que o pré-atendimento enviou; remove o que ela mesma enviou
    await expect(deletePreAnalysisFile(u.a, files[0].id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const mine = await db.preAnalysisFile.findFirstOrThrow({ where: { name: "renda.pdf" } });
    await deletePreAnalysisFile(u.a, mine.id);

    await runPreAnalysisRetention(new Date(NOW.getTime() + 200 * 24 * 3600_000));
    expect(await db.preAnalysisFile.count()).toBe(0);
  });

  it("o que vier preenchido continua sendo conferido", async () => {
    await expect(createPreAnalysis(jasmin, { consultantId: u.a.id, cpf: "111.111.111-11", phone: "123" }, NOW)).rejects.toMatchObject({ code: "VALIDATION", details: { cpf: expect.any(String), phone: expect.any(String) } });
  });
});

describe("agenda da semana e do mês", () => {
  it("agrupa por dia e conta por consultora", async () => {
    const { rangeAgenda } = await import("@/server/day-agenda");
    await visit("2026-10-14T15:00:00Z");
    await visit("2026-10-16T15:00:00Z", "222222");
    await visit("2026-10-20T15:00:00Z", "333333"); // semana seguinte
    const w = await rangeAgenda(jasmin, "2026-10-12", "2026-10-19");
    expect(w.days.map((d) => d.day)).toEqual(["2026-10-14", "2026-10-16"]);
    expect(w.byConsultant).toEqual([["Consultora A", 2]]);
    expect((await rangeAgenda(jasmin, "2026-10-01", "2026-11-01")).total).toBe(3);
    await expect(rangeAgenda(u.a, "2026-10-01", "2026-11-01")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("rodízio e cliente da consultora", () => {
  it("a vez é de quem recebeu há mais tempo, sem olhar quantas estão em aberto; cliente da consultora não conta a vez", async () => {
    const { assignmentQueue } = await import("@/server/pre-analysis");
    const base = { consultantId: u.a.id };
    await createPreAnalysis(jasmin, { ...base, consultantId: u.a.id }, new Date(NOW.getTime() - 3 * 3600_000));
    await createPreAnalysis(jasmin, { ...base, consultantId: u.a.id, cpf: "168.995.350-09" }, new Date(NOW.getTime() - 2 * 3600_000));
    await createPreAnalysis(jasmin, { ...base, consultantId: u.b.id, cpf: "390.533.447-05" }, new Date(NOW.getTime() - 1 * 3600_000));
    // A tem 2 em aberto e B só 1, mas a vez é de A (recebeu há mais tempo)
    let q = await assignmentQueue(NOW);
    expect(q.find((c) => c.isNext)?.id).toBe(u.a.id);
    expect(q.find((c) => c.isLast)?.id).toBe(u.b.id);
    // cliente que já era de A: vai para ela sem tirar a vez dela
    await createPreAnalysis(jasmin, { ...base, consultantId: u.a.id, cpf: "529.982.247-25", ownClient: true }, NOW);
    q = await assignmentQueue(new Date(NOW.getTime() + 60_000));
    expect(q.find((c) => c.isNext)?.id).toBe(u.a.id);
  });
});

describe("cancelar um imóvel ou todos, também no Google", () => {
  it("só um imóvel tira o código do título; todos move o evento para as 22h; a sincronização não cria conflito", async () => {
    const { MockCalendar, visitEvent } = await import("../helpers/mock-calendar");
    const { runSync } = await import("@/server/sync/engine");
    const { makeConnection } = await import("../helpers/db");
    await makeConnection("central@exemplo.test");
    const api = new MockCalendar();
    const title = "Visita clt - Cliente Exemplo 1234567 - cod 654321;765432;876543 - 51 99876-5432";
    api.put(visitEvent("multi", { start: "2026-10-14T15:00:00Z", title, organizer: "central@exemplo.test" }));
    const sync = (full = false) => runSync({ api, now: NOW, sleep: async () => {}, full });
    await sync();
    const vs = await db.visit.findMany({ orderBy: { createdAt: "asc" } });
    expect(vs.map((v) => v.propertyCode)).toEqual(["654321", "765432", "876543"]);
    const r = await cancelReason();

    // cliente não vai ao 1º imóvel (o da visita principal)
    const one = await cancelVisitByStaff(jasmin, vs[0].id, { reasonId: r.id, onlyThis: true }, NOW, { calendarApi: api });
    expect(one).toMatchObject({ count: 1, google: "code_removed" });
    expect((await api.getEvent("central@exemplo.test", "multi"))?.summary).toBe("Visita clt - Cliente Exemplo 1234567 - cod 765432;876543 - 51 99876-5432");
    await sync();
    await sync(true);
    const after = await db.visit.findMany({ orderBy: { createdAt: "asc" } });
    expect(after.map((v) => [v.propertyCode, v.status, v.syncConflict])).toEqual([
      ["654321", "CANCELED", "NONE"],
      ["765432", "SCHEDULED", "NONE"],
      ["876543", "SCHEDULED", "NONE"],
    ]);
    expect(await db.visit.count()).toBe(3);

    // depois desiste de tudo: o evento vai para as 22h no Google (continua na agenda)
    const all = await cancelVisitByStaff(jasmin, after[1].id, { reasonId: r.id }, NOW, { calendarApi: api });
    expect(all).toMatchObject({ count: 2, google: "moved" });
    expect((await api.getEvent("central@exemplo.test", "multi"))?.start?.dateTime).toBe("2026-10-15T01:00:00.000Z");
    await sync();
    expect((await db.visit.findMany()).every((v) => v.status === "CANCELED" && v.syncConflict === "NONE")).toBe(true);
  });

  it("sem permissão de edição só cancela no app e avisa", async () => {
    const v = await visit("2026-10-14T15:00:00Z");
    const r = await cancelReason();
    expect((await cancelVisitByStaff(jasmin, v.id, { reasonId: r.id }, NOW)).google).toBe("not_in_agenda");
  });
});
