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
    expect(await cancelVisitByStaff(jasmin, main.id, { reasonId: r.id, note: "achou outro" }, NOW)).toBe(2);
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
  it("garantia obrigatória; painel separa por garantia e por quem enviou", async () => {
    const base = { fullName: "Maria Titular da Silva", birthDate: "1990-05-20", cpf: "529.982.247-25", email: "maria@exemplo.test", phone: "(51) 99876-1234", salary: "4.500,00", consultantId: u.a.id, propertyCode: "", note: "", holderConfirmed: true as const };
    await expect(createPreAnalysis(jasmin, { ...base, guaranteeId: "" }, NOW)).rejects.toMatchObject({ code: "VALIDATION", details: { guaranteeId: expect.any(String) } });
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
