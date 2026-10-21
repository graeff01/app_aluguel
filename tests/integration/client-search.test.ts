// Cliente em busca: nasce na visita negativa / negócio que caiu, perfil, contatos, esfriando, encerramento e LGPD.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { concludeVisit, createManualVisit } from "@/server/visits";
import {
  closeClientSearch,
  closeSearchOnWin,
  clientSearchDetail,
  listClientSearches,
  logSearchContact,
  searchStats,
  searchSummaryFor,
  startClientSearch,
  updateSearchProfile,
} from "@/server/client-search";
import { anonymizeClient } from "@/server/privacy";
import { makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
const NOW = new Date("2026-10-13T15:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86400_000);

async function negativeVisit(phone = "(51) 99263-0924", code = "843483", consultantId?: string) {
  const v = await createManualVisit(u.admin, { requestId: `cs-${code}-${phone}`, scheduledStart: "2026-10-13T10:00", clientName: "Ana Paula Longaray", phoneRaw: phone, propertyCode: code, consultantId: consultantId ?? u.a.id });
  await concludeVisit(u.a.id === (consultantId ?? u.a.id) ? u.a : u.b, v.id, { requestId: `cs-done-${code}-${phone}`, expectedVersion: 1, status: "DONE", evaluation: "NEGATIVE", negativeReasonId: (await db.reason.findFirstOrThrow({ where: { kind: "VISIT_NEGATIVE", label: "Características do imóvel" } })).id, note: "Não gostou da planta" }, NOW);
  return v;
}

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

describe("cliente em busca", () => {
  it("visita negativa → busca ativa (uma por cliente), escopo da consultora, perfil e contato", async () => {
    const v = await negativeVisit();
    const s = await startClientSearch(u.a, { visitId: v.id }, {}, NOW);
    expect(s.created).toBe(true);
    // de novo (ou por outro imóvel do mesmo cliente): mesma busca
    expect(await startClientSearch(u.a, { visitId: v.id }, { areas: "Centro" }, NOW)).toEqual({ id: s.id, created: false });
    const row = await db.clientSearch.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ status: "ACTIVE", consultantId: u.a.id, areas: ["Centro"] });
    expect(row.note).toMatch(/Recusou o imóvel 843483 \(características do imóvel\)/);
    // o negócio do imóvel recusado continua "caiu" (não infla o funil)
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id }, include: { opportunity: true } })).opportunity?.status).toBe("LOST");

    // outra consultora não vê nem mexe
    await expect(startClientSearch(u.b, { visitId: v.id }, {}, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(clientSearchDetail(u.b, s.id, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listClientSearches(u.b, {}, NOW)).toHaveLength(0);
    expect(await listClientSearches(u.manager, {}, NOW)).toHaveLength(1);

    await updateSearchProfile(u.a, s.id, { maxBudget: "2.500", areas: "Centro; Marechal Rondon, Centro", propertyType: "Casa", bedrooms: "2", mustNot: "sem escadas" });
    await expect(updateSearchProfile(u.a, s.id, { maxBudget: "abc" })).rejects.toMatchObject({ code: "VALIDATION" });
    const d = await clientSearchDetail(u.a, s.id, NOW);
    expect(d).toMatchObject({ maxBudgetCents: 250000, areas: ["Centro", "Marechal Rondon"], propertyType: "Casa", bedrooms: 2, mustNot: "sem escadas", phone: "+5551992630924", lastVisitId: v.id });
    expect(d.seen.map((x) => x.propertyCode)).toEqual(["843483"]);

    // retorno padrão em 3 dias: aparece como "ligar hoje" no dia
    expect((await searchSummaryFor(u.a, days(1))).due).toBe(0);
    expect(await searchSummaryFor(u.a, days(3))).toMatchObject({ active: 1, due: 1, stale: 0 });
    // sem contato há 7+ dias: esfriando
    expect((await searchSummaryFor(u.a, days(8))).stale).toBe(1);
    await logSearchContact(u.a, s.id, { note: "Mandei 3 opções", followUpDays: 7 }, days(8));
    const after = (await listClientSearches(u.a, {}, days(9)))[0];
    expect(after).toMatchObject({ stale: false, due: false });
    expect(after.note).toMatch(/21\/10: Mandei 3 opções/);
  });

  it("encerramentos: manual, por contrato assinado e indicadores", async () => {
    const v1 = await negativeVisit("(51) 99263-0924", "843483");
    const v2 = await negativeVisit("(51) 99876-5555", "761739");
    const s1 = await startClientSearch(u.a, { visitId: v1.id }, {}, NOW);
    const s2 = await startClientSearch(u.a, { visitId: v2.id }, {}, NOW);
    await expect(closeClientSearch(u.a, s1.id, "XX", "", days(5))).rejects.toMatchObject({ code: "VALIDATION" });
    await closeClientSearch(u.a, s1.id, "LOST_ELSEWHERE", "Fechou com outra imobiliária", days(5));
    await expect(logSearchContact(u.a, s1.id, { followUpDays: 3 }, days(6))).rejects.toMatchObject({ code: "INVALID_STATE" });
    // contrato assinado do cliente encerra como "Alugou conosco"
    const c2 = (await db.visit.findUniqueOrThrow({ where: { id: v2.id } })).clientId!;
    await db.$transaction((tx) => closeSearchOnWin(tx, c2, u.a.id, days(12)));
    expect(await db.clientSearch.findUniqueOrThrow({ where: { id: s2.id } })).toMatchObject({ status: "WON" });
    // pode recomeçar uma busca depois de encerrada
    expect((await startClientSearch(u.a, { visitId: v1.id }, {}, days(20))).created).toBe(true);

    const st = await searchStats(u.manager, NOW, days(20));
    expect(st).toMatchObject({ active: 1, won: 1, lostElsewhere: 1, gaveUp: 0, conversion: 0.5, avgDaysToWin: 12 });
    await expect(searchStats(u.a, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listClientSearches(u.a, { tab: "encerradas" }, days(20))).toHaveLength(2);
  });

  it("negócio que caiu → busca; anonimização (LGPD) apaga o perfil", async () => {
    const v = await negativeVisit();
    const opp = (await db.visit.findUniqueOrThrow({ where: { id: v.id } })).opportunityId!;
    const s = await startClientSearch(u.a, { opportunityId: opp }, { mustNot: "sem escadas", note: "Prefere térreo" }, NOW);
    expect((await db.clientSearch.findUniqueOrThrow({ where: { id: s.id } })).note).toBe("Prefere térreo");
    const clientId = (await db.visit.findUniqueOrThrow({ where: { id: v.id } })).clientId!;
    await anonymizeClient(u.admin, clientId, "Pedido do titular");
    expect(await db.clientSearch.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ note: null, mustNot: null, areas: [] });
  });

  it("visita sem cliente identificado não abre busca", async () => {
    const v = await createManualVisit(u.admin, { requestId: "cs-nophone", scheduledStart: "2026-10-13T10:00", clientName: "Sem Telefone", phoneRaw: "", propertyCode: "111", consultantId: u.a.id });
    await db.visit.update({ where: { id: v.id }, data: { clientId: null } });
    await expect(startClientSearch(u.a, { visitId: v.id }, {}, NOW)).rejects.toMatchObject({ code: "MISSING_DATA" });
  });
});
