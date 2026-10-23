// Propostas (rodízio compartilhado com a pré-análise, andamento, escopo, LGPD) e pós-contrato da consultora.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { assignmentQueue, createPreAnalysis } from "@/server/pre-analysis";
import { createProposal, deleteProposal, listProposals, proposalDetail, runProposalRetention, updateProposalStatus } from "@/server/proposals";
import { aftercareMessage, completeAftercare, dueAftercare, setAftercare } from "@/server/aftercare";
import { sendOperationalAlerts } from "@/server/reminders";
import { makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
const NOW = new Date("2026-10-23T15:00:00Z");
const H = 3600_000;
const DAY = 24 * H;
const valid = (o: Partial<Parameters<typeof createProposal>[1]> = {}) => ({
  clientName: "Carlos Proponente",
  phone: "(51) 99876-4321",
  rent: "2.300,00",
  propertyCode: "734999",
  consultantId: u.a.id,
  ...o,
});
const nextOf = async (now: Date) => (await assignmentQueue(now)).find((c) => c.isNext)?.id;

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  const j = await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } });
  jasmin = { id: j.id, role: "PRE_SERVICE" };
});

describe("proposta", () => {
  it("pré-atendimento envia; telefone cifrado; campos conferidos; só a consultora encaminhada e a gestão veem", async () => {
    await expect(createProposal(u.a, valid(), NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createProposal(jasmin, valid({ phone: "123", rent: "abc", propertyCode: "" }), NOW)).rejects.toMatchObject({ code: "VALIDATION", details: { propertyCode: expect.any(String) } });
    await expect(createProposal(jasmin, valid({ phone: "123", rent: "abc" }), NOW)).rejects.toMatchObject({ code: "VALIDATION", details: { phone: expect.any(String), rent: expect.any(String) } });
    await expect(createProposal(jasmin, valid({ consultantId: u.manager.id }), NOW)).rejects.toMatchObject({ code: "VALIDATION" });

    const p = await createProposal(jasmin, valid({ requestId: "req-1" }), NOW);
    const raw = await db.proposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(raw.rentCents).toBe(230000);
    expect(raw.phoneEnc).not.toContain("99876");
    expect(raw.status).toBe("NEW");
    // reenvio do mesmo formulário não duplica
    expect((await createProposal(jasmin, valid({ requestId: "req-1" }), NOW)).id).toBe(p.id);
    expect(await db.proposal.count()).toBe(1);

    const d = await proposalDetail(u.a, p.id);
    expect(d.phone).toBe("+5551998764321");
    expect(d.canUpdate).toBe(true);
    await expect(proposalDetail(u.b, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await proposalDetail(jasmin, p.id)).canUpdate).toBe(false);
    expect(await listProposals(u.b)).toHaveLength(0);
    expect(await listProposals(u.a)).toHaveLength(1);
    expect(await listProposals(jasmin)).toHaveLength(1);
    expect(await db.auditLog.count({ where: { action: "proposal.viewed", entityId: p.id } })).toBe(2);
  });

  it("rodízio único: pré-análise e proposta dividem a vez; cliente da consultora não conta", async () => {
    // ninguém recebeu: A (ordem alfabética)
    expect(await nextOf(NOW)).toBe(u.a.id);
    await createPreAnalysis(jasmin, { fullName: "Maria", consultantId: u.a.id, holderConfirmed: true }, NOW);
    expect(await nextOf(new Date(NOW.getTime() + 1000))).toBe(u.b.id);
    // a proposta vai para B (a da vez) e a vez volta para A
    await db.proposal.create({ data: { createdById: jasmin.id, consultantId: u.b.id, clientName: "X", rentCents: 1, propertyCode: "1", createdAt: new Date(NOW.getTime() + 60_000) } });
    expect(await nextOf(new Date(NOW.getTime() + 2 * 60_000))).toBe(u.a.id);
    // proposta de cliente que já era da A: não conta a vez
    await db.proposal.create({ data: { createdById: jasmin.id, consultantId: u.a.id, clientName: "Y", rentCents: 1, propertyCode: "2", ownClient: true, createdAt: new Date(NOW.getTime() + 3 * 60_000) } });
    const q = await assignmentQueue(new Date(NOW.getTime() + 4 * 60_000));
    expect(q.find((c) => c.isNext)?.id).toBe(u.a.id);
    // contadores somam as duas filas
    expect(q.find((c) => c.id === u.a.id)).toMatchObject({ monthCount: 2, openCount: 2 });
    expect(q.find((c) => c.id === u.b.id)).toMatchObject({ monthCount: 1, openCount: 1 });
  });

  it("andamento: consultora registra, contraproposta pede valor, recusa pede motivo; excluir só enquanto nova", async () => {
    const p = await createProposal(jasmin, valid(), NOW);
    await expect(updateProposalStatus(u.b, p.id, { status: "SENT" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateProposalStatus(jasmin, p.id, { status: "SENT" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateProposalStatus(u.a, p.id, { status: "NEW" }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await updateProposalStatus(u.a, p.id, { status: "SENT", note: "Enviada por WhatsApp" }, NOW)).toBe("SENT");
    await expect(deleteProposal(jasmin, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateProposalStatus(u.a, p.id, { status: "COUNTER", counter: "" }, NOW)).rejects.toMatchObject({ details: { counter: expect.any(String) } });
    await updateProposalStatus(u.a, p.id, { status: "COUNTER", counter: "2.450,00" }, NOW);
    await expect(updateProposalStatus(u.a, p.id, { status: "REJECTED", note: "" }, NOW)).rejects.toMatchObject({ details: { note: expect.any(String) } });
    await updateProposalStatus(u.manager, p.id, { status: "ACCEPTED" }, NOW);
    const r = await db.proposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(r).toMatchObject({ status: "ACCEPTED", counterCents: 245000, statusById: u.manager.id });
    expect(await listProposals(u.a, { tab: "encerradas" })).toHaveLength(1);

    const q = await createProposal(jasmin, valid({ consultantId: u.b.id }), NOW);
    await deleteProposal(jasmin, q.id);
    expect(await db.proposal.count()).toBe(1);
  });

  it("LGPD: telefone apagado no prazo; liga ao cadastro do cliente pelo telefone", async () => {
    const client = await db.client.create({ data: { name: "Carlos", phones: { create: { raw: "51998764321", normalized: "+5551998764321", valid: true } } } });
    const p = await createProposal(jasmin, valid(), NOW);
    expect((await db.proposal.findUniqueOrThrow({ where: { id: p.id } })).clientId).toBe(client.id);
    await updateProposalStatus(u.a, p.id, { status: "REJECTED", note: "Proprietário não aceita" }, NOW);
    expect((await runProposalRetention(new Date(NOW.getTime() + 30 * DAY))).purged).toBe(0);
    expect((await runProposalRetention(new Date(NOW.getTime() + 91 * DAY))).purged).toBe(1);
    const r = await db.proposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(r.phoneEnc).toBeNull();
    expect(r.purgedAt).not.toBeNull();
    expect(r.clientName).toBe("Carlos Proponente");
  });
});

describe("pós-contrato", () => {
  async function signedDeal(responsibleId: string, closedOn: string, status: "CLOSED_WON" | "LOST" = "CLOSED_WON") {
    const client = await db.client.create({ data: { name: "Ana Cliente Nova", phones: { create: { raw: "51999990000", normalized: "+5551999990000", valid: true } } } });
    const property = await db.property.upsert({ where: { code: "761739" }, update: {}, create: { code: "761739" } });
    return db.opportunity.create({
      data: { clientId: client.id, propertyId: property.id, status, stage: status === "CLOSED_WON" ? "SIGNED" : null, responsibleId, closedResponsibleId: status === "CLOSED_WON" ? responsibleId : null, firstDoneVisitAt: new Date(`${closedOn}T12:00:00Z`), closedAt: status === "CLOSED_WON" ? new Date(`${closedOn}T00:00:00Z`) : null, ...(status === "LOST" ? { lostOrigin: "LATER", lostNote: "Desistiu" } : {}) },
    });
  }

  it("só para quem tem a opção ligada; 5 dias depois da assinatura e 5 dias depois do 1º contato", async () => {
    const day = (k: string) => new Date(`${k}T15:00:00Z`);
    const deal = await signedDeal(u.a.id, "2026-10-24");
    // desligado: nada
    expect(await dueAftercare(u.a.id, day("2026-11-05"))).toEqual([]);
    await expect(setAftercare(u.a, u.a.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setAftercare(u.manager, jasmin.id, true)).rejects.toMatchObject({ code: "VALIDATION" });
    await setAftercare(u.manager, u.a.id, true, day("2026-10-23"));
    // contrato de antes da opção ligada não entra
    await signedDeal(u.a.id, "2026-10-20");
    // negócio que caiu não entra; de outra consultora não aparece para ela
    await signedDeal(u.a.id, "2026-10-24", "LOST");
    await signedDeal(u.b.id, "2026-10-24");

    expect(await dueAftercare(u.a.id, day("2026-10-28"))).toEqual([]);
    const due = await dueAftercare(u.a.id, day("2026-10-29"));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ opportunityId: deal.id, step: "welcome", dueOn: "2026-10-29", phone: "+5551999990000", clientName: "Ana Cliente Nova" });
    expect(due[0].message).toContain("Oi, Ana! Aqui é a Consultora.");
    // continua pendente nos dias seguintes até marcar como feito
    expect(await dueAftercare(u.a.id, day("2026-11-02"))).toHaveLength(1);

    await expect(completeAftercare(u.b, deal.id, "welcome", day("2026-11-02"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(completeAftercare(u.a, deal.id, "referral", day("2026-11-02"))).rejects.toMatchObject({ code: "INVALID_STATE" });
    await completeAftercare(u.a, deal.id, "welcome", day("2026-11-02"));
    await expect(completeAftercare(u.a, deal.id, "welcome", day("2026-11-02"))).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await dueAftercare(u.a.id, day("2026-11-06"))).toEqual([]);
    const ref = await dueAftercare(u.a.id, day("2026-11-07"));
    expect(ref).toMatchObject([{ step: "referral", dueOn: "2026-11-07" }]);
    expect(ref[0].message).toContain("indicar");

    await completeAftercare(u.a, deal.id, "referral", day("2026-11-07"));
    expect(await dueAftercare(u.a.id, day("2026-11-20"))).toEqual([]);
    // fica no histórico do negócio
    expect(await db.opportunityEvent.count({ where: { opportunityId: deal.id, note: { startsWith: "Pós-contrato" } } })).toBe(2);

    // desligar some com os lembretes
    const other = await signedDeal(u.a.id, "2026-11-01");
    expect((await dueAftercare(u.a.id, day("2026-11-07"))).map((d) => d.opportunityId)).toEqual([other.id]);
    await setAftercare(u.manager, u.a.id, false);
    expect(await dueAftercare(u.a.id, day("2026-11-07"))).toEqual([]);
  });

  it("mensagens prontas", () => {
    expect(aftercareMessage("welcome", "Maria Souza", "Eduarda Lima")).toMatch(/^Oi, Maria! Aqui é a Eduarda\./);
    expect(aftercareMessage("referral", "", "Eduarda")).toMatch(/^Oi! /);
  });
});

describe("avisos no celular", () => {
  it("proposta sem andamento lembra a consultora (2 h) e escala (24 h); pós-contrato avisa uma vez por dia; sem dados do cliente", async () => {
    await db.appSettings.update({ where: { id: 1 }, data: { remindersEnabled: true } });
    await db.pushSubscription.createMany({ data: [u.a, u.manager, jasmin].map((x, i) => ({ userId: x.id, endpoint: `https://push.test/${i}`, p256dh: "k", auth: "a" })) });
    const p = await createProposal(jasmin, valid(), new Date(NOW.getTime() - 25 * H));
    await db.proposal.update({ where: { id: p.id }, data: { createdAt: new Date(NOW.getTime() - 25 * H) } });
    await setAftercare(u.manager, u.a.id, true, new Date("2026-10-01T12:00:00Z"));
    const client = await db.client.create({ data: { name: "Cliente Secreto" } });
    const property = await db.property.create({ data: { code: "761739" } });
    await db.opportunity.create({ data: { clientId: client.id, propertyId: property.id, status: "CLOSED_WON", stage: "SIGNED", responsibleId: u.a.id, closedResponsibleId: u.a.id, firstDoneVisitAt: NOW, closedAt: new Date("2026-10-10T00:00:00Z") } });

    const sent: [string, string][] = [];
    const send = async (t: { endpoint: string }, pl: { title: string; body: string }) => (sent.push([t.endpoint, `${pl.title} ${pl.body}`]), "ok" as const);
    await sendOperationalAlerts(NOW, { send, email: null });
    await sendOperationalAlerts(new Date(NOW.getTime() + 60_000), { send, email: null });
    expect(sent.filter((x) => x[1].startsWith("Proposta esperando você")).map((x) => x[0])).toEqual(["https://push.test/0"]);
    expect(sent.filter((x) => x[1].startsWith("Proposta sem andamento")).map((x) => x[0]).sort()).toEqual(["https://push.test/1", "https://push.test/2"]);
    expect(sent.filter((x) => x[1].startsWith("1 cliente para o pós-contrato")).map((x) => x[0])).toEqual(["https://push.test/0"]);
    expect(JSON.stringify(sent)).not.toMatch(/Secreto|Carlos/);
  });
});
