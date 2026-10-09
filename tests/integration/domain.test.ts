// Regras de negócio com Postgres real (dados sintéticos).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { assignVisit, concludeVisit, correctVisitData, createManualVisit, setVisitExcluded } from "@/server/visits";
import { linkVisitToClient, mergeClients } from "@/server/clients";
import { updateOpportunity } from "@/server/opportunities";
import { getVisitDetail, listHistory, listPending, listToday } from "@/server/queries";
import { makeUsers, reason, resetDb } from "../helpers/db";

const NOW = new Date("2026-10-06T18:00:00Z");
let u: Awaited<ReturnType<typeof makeUsers>>;
let seq = 0;
const rid = () => `req-${Date.now()}-${++seq}`;

async function manual(actor: { id: string; role: "ADMIN" | "MANAGER" | "CONSULTANT" }, p: { name?: string; phone?: string; code?: string; start?: string; consultantId?: string } = {}) {
  return createManualVisit(actor, {
    requestId: rid(),
    scheduledStart: p.start ?? "2026-10-06T10:00",
    durationMinutes: 60,
    clientName: p.name ?? "Cliente Sintético",
    phoneRaw: p.phone ?? "(51) 99876-5432",
    propertyCode: p.code ?? "0101",
    consultantId: p.consultantId,
  });
}

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

describe("autorização (critério 6)", () => {
  it("consultora não lê nem altera visita de outra, inclusive por ID direto", async () => {
    const vb = await manual(u.b);
    await expect(getVisitDetail(u.a, vb.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      concludeVisit(u.a, vb.id, { requestId: rid(), expectedVersion: 1, status: "NO_SHOW", note: "tentativa" }, NOW),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(correctVisitData(u.a, vb.id, { expectedVersion: 1, clientName: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assignVisit(u.a, vb.id, u.a.id, "")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const histA = await listHistory(u.a, {});
    expect(histA.items.map((v) => v.id)).not.toContain(vb.id);
  });

  it("cliente compartilhado não revela visitas de outra consultora", async () => {
    const va = await manual(u.a, { name: "Pessoa Comum", phone: "(51) 99111-2222" });
    const vb = await manual(u.b, { name: "Pessoa Comum", phone: "(51) 99111-2222" });
    expect(va.clientId).toBe(vb.clientId); // mesmo cliente confirmado por telefone
    const detail = await getVisitDetail(u.a, va.id, NOW);
    expect(detail.relatedVisits.map((v) => v.id)).not.toContain(vb.id);
    const search = await listHistory(u.a, { q: "99111" });
    expect(search.items.map((v) => v.id)).toEqual([va.id]);
  });

  it("gestora e admin veem tudo", async () => {
    const va = await manual(u.a);
    const vb = await manual(u.b);
    for (const actor of [u.manager, u.admin]) {
      const h = await listHistory(actor, {});
      expect(h.items.map((v) => v.id).sort()).toEqual([va.id, vb.id].sort());
      await expect(getVisitDetail(actor, vb.id, NOW)).resolves.toBeTruthy();
    }
  });

  it("consultora não cria visita em nome de outra", async () => {
    const v = await manual(u.a, { consultantId: u.b.id });
    expect(v.consultantId).toBe(u.a.id);
  });
});

describe("conclusão (critérios 7 e 8)", () => {
  it("rejeita observação vazia ou só com espaços, no servidor", async () => {
    const v = await manual(u.a);
    for (const note of ["", "   ", "\n\t "]) {
      await expect(concludeVisit(u.a, v.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(concludeVisit(u.a, v.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "x".repeat(2001) }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("SCHEDULED");
  });

  it("negativa exige motivo; realizada exige nome e código", async () => {
    const v = await manual(u.a);
    await expect(concludeVisit(u.a, v.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "NEGATIVE", note: "não gostou" }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    const google = await db.visit.create({
      data: { origin: "GOOGLE", scheduledStart: new Date("2026-10-06T12:00:00Z"), scheduledEnd: new Date("2026-10-06T13:00:00Z"), consultantId: u.a.id, assignmentStatus: "AUTO", clientName: null, propertyCode: null },
    });
    await expect(concludeVisit(u.a, google.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "ok" }, NOW)).rejects.toMatchObject({ code: "MISSING_DATA" });
    // não compareceu não exige nome/código
    await expect(concludeVisit(u.a, google.id, { requestId: rid(), expectedVersion: 1, status: "NO_SHOW", note: "não veio" }, NOW)).resolves.toBeTruthy();
  });

  it("telefone inválido não impede registrar o resultado", async () => {
    const v = await manual(u.a, { phone: "9999-1234" });
    expect(v.phoneNormalized).toBeNull();
    const r = await concludeVisit(u.a, v.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "UNDECIDED", note: "pensando" }, NOW);
    expect(r.visit.status).toBe("DONE");
  });

  it("passagem do horário não marca visita como realizada", async () => {
    const v = await manual(u.a, { start: "2026-10-01T09:00" });
    const pending = await listPending(u.a, NOW);
    expect(pending.awaiting.map((x) => x.id)).toContain(v.id);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("SCHEDULED");
  });

  it("duplo clique / retry com mesmo requestId não duplica avaliação", async () => {
    const v = await manual(u.a);
    const input = { requestId: "same-request-123", expectedVersion: 1, status: "DONE" as const, evaluation: "POSITIVE" as const, note: "Gostou" };
    const results = await Promise.allSettled([concludeVisit(u.a, v.id, input, NOW), concludeVisit(u.a, v.id, input, NOW), concludeVisit(u.a, v.id, input, NOW)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await db.visitOutcomeHistory.count({ where: { visitId: v.id } })).toBe(1);
    expect(await db.opportunity.count()).toBe(1);
  });

  it("edição simultânea com versão antiga é recusada (sem perda silenciosa)", async () => {
    const v = await manual(u.a);
    await concludeVisit(u.manager, v.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "Gestora registrou" }, NOW);
    await expect(
      concludeVisit(u.a, v.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "NEGATIVE", negativeReasonId: (await reason("Localização")).id, note: "Consultora" }, NOW),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).note).toBe("Gestora registrou");
  });

  it("cadastro manual repetido com mesma chave não duplica", async () => {
    const input = { requestId: "manual-same-1", scheduledStart: "2026-10-06T10:00", clientName: "Fulano", phoneRaw: "", propertyCode: "1" };
    const [a, b] = await Promise.all([createManualVisit(u.a, input), createManualVisit(u.a, input).catch(() => null)]);
    expect(await db.visit.count()).toBe(1);
    expect(a.id).toBeTruthy();
    void b;
  });
});

describe("oportunidades e clientes (critério 9)", () => {
  it("várias visitas do mesmo cliente ao mesmo imóvel formam uma oportunidade e um fechamento", async () => {
    const v1 = await manual(u.a, { start: "2026-10-01T10:00" });
    const v2 = await manual(u.a, { start: "2026-10-03T10:00" });
    await concludeVisit(u.a, v1.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "UNDECIDED", note: "1ª" }, NOW);
    await concludeVisit(u.a, v2.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "2ª" }, NOW);
    const opps = await db.opportunity.findMany();
    expect(opps).toHaveLength(1);
    expect(opps[0].firstDoneVisitAt.toISOString()).toBe(v1.scheduledStart.toISOString());
    await updateOpportunity(u.a, opps[0].id, { expectedVersion: opps[0].version, toStatus: "CLOSED_WON", closedAt: "2026-10-05" });
    expect(await db.opportunity.count({ where: { status: "CLOSED_WON" } })).toBe(1);

    // nova visita depois do fechamento abre novo ciclo explícito
    const v3 = await manual(u.a, { start: "2026-10-06T10:00" });
    await concludeVisit(u.a, v3.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "3ª" }, NOW);
    const all = await db.opportunity.findMany({ orderBy: { cycle: "asc" } });
    expect(all.map((o) => [o.cycle, o.status])).toEqual([[1, "CLOSED_WON"], [2, "FOLLOW_UP"]]);
  });

  it("cliente com vários imóveis tem oportunidades separadas", async () => {
    const v1 = await manual(u.a, { code: "A1" });
    const v2 = await manual(u.a, { code: "B2" });
    expect(v1.clientId).toBe(v2.clientId);
    await concludeVisit(u.a, v1.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "a" }, NOW);
    await concludeVisit(u.a, v2.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "b" }, NOW);
    expect(await db.opportunity.count()).toBe(2);
  });

  it("negativa encerra como perdida (origem visita); fechamento exige data; perda posterior exige motivo e observação", async () => {
    const v = await manual(u.a);
    await concludeVisit(u.a, v.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "NEGATIVE", negativeReasonId: (await reason("Preço/custo total")).id, note: "caro" }, NOW);
    const lost = await db.opportunity.findFirstOrThrow();
    expect(lost).toMatchObject({ status: "LOST", lostOrigin: "VISIT_NEGATIVE" });

    const v2 = await manual(u.a, { code: "X9" });
    await concludeVisit(u.a, v2.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "ok" }, NOW);
    const o = await db.opportunity.findFirstOrThrow({ where: { status: "FOLLOW_UP" } });
    await expect(updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "CLOSED_WON" })).rejects.toBeTruthy();
    await expect(updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "LOST", lostReasonId: (await reason("Desistiu da locação", "OPPORTUNITY_LOST")).id })).rejects.toBeTruthy();
    await updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "LOST", lostReasonId: (await reason("Desistiu da locação", "OPPORTUNITY_LOST")).id, note: "desistiu" });
    const after = await db.opportunity.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.lostOrigin).toBe("LATER");
    expect(await db.opportunityEvent.count({ where: { opportunityId: o.id } })).toBe(2);
  });

  it("consultora não altera oportunidade de outra; gestora sim", async () => {
    const v = await manual(u.b);
    await concludeVisit(u.b, v.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "ok" }, NOW);
    const o = await db.opportunity.findFirstOrThrow();
    await expect(updateOpportunity(u.a, o.id, { expectedVersion: o.version, toStatus: "DOCS_REVIEW" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await updateOpportunity(u.manager, o.id, { expectedVersion: o.version, toStatus: "DOCS_REVIEW" });
  });

  it("telefone compartilhado com nome incompatível não funde pessoas automaticamente", async () => {
    const v1 = await manual(u.a, { name: "Ana Souza", phone: "(51) 99555-0000" });
    const v2 = await manual(u.a, { name: "Bruno Lima", phone: "(51) 99555-0000" });
    expect(v1.clientId).not.toBe(v2.clientId);
    expect(v2.clientMatch).toBe("SUGGESTED");
    expect(v2.clientCandidates).toEqual([v1.clientId]);
    const c2 = await db.client.findUniqueOrThrow({ where: { id: v2.clientId! } });
    expect(c2.identityStatus).toBe("PENDING");
  });

  it("sem telefone não une pelo nome", async () => {
    const v1 = await manual(u.a, { name: "Carla Dias", phone: "" });
    const v2 = await manual(u.a, { name: "Carla Dias", phone: "" });
    expect(v1.clientId).not.toBe(v2.clientId);
    expect(v1.clientMatch).toBe("NO_PHONE");
  });

  it("gestora une cadastros em transação, sem multiplicar oportunidades", async () => {
    const v1 = await manual(u.a, { name: "Dora", phone: "" });
    const v2 = await manual(u.a, { name: "Dora", phone: "(51) 99777-1111" });
    await concludeVisit(u.a, v1.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "a" }, NOW);
    await concludeVisit(u.a, v2.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "b" }, NOW);
    expect(await db.opportunity.count()).toBe(2);
    await expect(mergeClients(u.a, v1.clientId!, v2.clientId!)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await mergeClients(u.manager, v1.clientId!, v2.clientId!);
    expect(await db.opportunity.count()).toBe(1);
    const opp = await db.opportunity.findFirstOrThrow({ include: { visits: true } });
    expect(opp.visits).toHaveLength(2);
    expect(await db.auditLog.count({ where: { action: "client.merged" } })).toBe(1);
  });

  it("vincular visita a cliente existente move a oportunidade", async () => {
    const v1 = await manual(u.a, { name: "Eva", phone: "(51) 99888-1111" });
    const v2 = await manual(u.a, { name: "Eva Prado", phone: "" });
    await concludeVisit(u.a, v2.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "b" }, NOW);
    await linkVisitToClient(u.manager, v2.id, v1.clientId!);
    const moved = await db.visit.findUniqueOrThrow({ where: { id: v2.id }, include: { opportunity: true } });
    expect(moved.clientId).toBe(v1.clientId);
    expect(moved.opportunity?.clientId).toBe(v1.clientId);
    expect(await db.client.count({ where: { id: v2.clientId! } })).toBe(0); // cadastro órfão removido
  });

  it("correção de resultado de negativa para positiva reabre a oportunidade (sem duplicar)", async () => {
    const v = await manual(u.a);
    const r1 = await concludeVisit(u.a, v.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "NEGATIVE", negativeReasonId: (await reason("Outro")).id, note: "x" }, NOW);
    await concludeVisit(u.a, v.id, { requestId: rid(), expectedVersion: r1.visit.version, status: "DONE", evaluation: "POSITIVE", note: "corrigido" }, NOW);
    const opps = await db.opportunity.findMany();
    expect(opps).toHaveLength(1);
    expect(opps[0].status).toBe("FOLLOW_UP");
    expect(await db.visitOutcomeHistory.count({ where: { visitId: v.id } })).toBe(2);
  });

  it("visita excluída sai das oportunidades", async () => {
    const v = await manual(u.a);
    await concludeVisit(u.a, v.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "x" }, NOW);
    await setVisitExcluded(u.manager, v.id, true, "não era visita comercial");
    expect(await db.opportunity.count()).toBe(0);
  });

  it("hoje lista visitas do dia no fuso de São Paulo", async () => {
    await manual(u.a, { start: "2026-10-06T21:30" }); // 00:30 UTC do dia 07
    const today = await listToday(u.a, NOW);
    expect(today.visits).toHaveLength(1);
  });
});

describe("revisita e quem agendou", () => {
  it("visita marcada pela consultora após visita realizada aparece como revisita agendada por ela", async () => {
    // 1ª visita: veio da agenda central (sem quem agendou)
    const first = await manual(u.a, { start: "2026-10-05T10:00", code: "0101" });
    await db.visit.update({ where: { id: first.id }, data: { origin: "GOOGLE", scheduledById: null } });
    await concludeVisit(u.a, first.id, { requestId: rid(), expectedVersion: 1, status: "DONE", evaluation: "UNDECIDED", note: "quer ver outros" }, NOW);

    // 2ª visita: a consultora agenda no app
    const second = await manual(u.a, { start: "2026-10-06T16:00", code: "0202" });
    expect(second.scheduledById).toBe(u.a.id);

    const detail = await getVisitDetail(u.a, second.id, NOW);
    expect(detail.visit.scheduledBy).toMatchObject({ id: u.a.id, role: "CONSULTANT" });
    expect(detail.visit.revisit).toMatchObject({ previous: 1, sameProperty: false });

    const firstDetail = await getVisitDetail(u.a, first.id, NOW);
    expect(firstDetail.visit.revisit).toBeNull();
    expect(firstDetail.visit.scheduledBy).toBeNull();

    const today = await listToday(u.a, NOW);
    expect(today.visits.find((v) => v.id === second.id)?.revisit?.previous).toBe(1);
  });

  it("visita anterior não realizada não conta como revisita", async () => {
    const first = await manual(u.a, { start: "2026-10-05T10:00" });
    await concludeVisit(u.a, first.id, { requestId: rid(), expectedVersion: 1, status: "NO_SHOW", note: "não veio" }, NOW);
    const second = await manual(u.a, { start: "2026-10-06T16:00" });
    expect((await getVisitDetail(u.a, second.id, NOW)).visit.revisit).toBeNull();
  });
});
