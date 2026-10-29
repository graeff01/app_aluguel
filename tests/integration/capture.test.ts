// Captação: pedido da consultora, "estou buscando", retorno das indicações, placar do mês e bom dia das 8h.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createRadar, captureFound, listRadar } from "@/server/radar";
import { closeCaptureForSearch, captureForSearch, captureScoreboard, requestCaptureFromSearch, sendCaptureMorning, setCaptureOwner } from "@/server/capture";
import { closeClientSearch, updateSearchProfile } from "@/server/client-search";
import { captureRequests } from "@/server/demand";
import { countUnreadAlerts, latestUnreadAlert, listAlerts } from "@/server/alerts";
import { makeUsers, resetDb } from "../helpers/db";

const NOW = new Date("2026-10-28T13:00:00Z"); // 10h em Brasília
const DAY = 86400_000;
let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
let danusa: { id: string; role: "CAPTURE" };
let henrique: { id: string; role: "CAPTURE" };

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  jasmin = { id: (await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } })).id, role: "PRE_SERVICE" };
  danusa = { id: (await db.user.create({ data: { name: "Danusa Oliveira", email: "danusa@exemplo.test", role: "CAPTURE" } })).id, role: "CAPTURE" };
  henrique = { id: (await db.user.create({ data: { name: "Henrique Martins", email: "henrique@exemplo.test", role: "CAPTURE" } })).id, role: "CAPTURE" };
});

async function searchFor(consultantId: string, profile = { areas: ["Centro"], propertyType: "Casa", bedrooms: 2, maxBudgetCents: 250000 }) {
  const client = await db.client.create({ data: { name: "Bruno Cliente" } });
  return db.clientSearch.create({ data: { clientId: client.id, consultantId, createdById: consultantId, ...profile } });
}

describe("pedido da consultora à captação", () => {
  it("vai só o perfil; a captação é avisada; o que ela faz volta para a consultora (não para o pré-atendimento)", async () => {
    const s = await searchFor(u.a.id);
    await expect(requestCaptureFromSearch(u.b, s.id, "Casa com pátio", NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requestCaptureFromSearch(u.a, s.id, "oi", NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    const r = await requestCaptureFromSearch(u.a, s.id, "Casa com pátio para cachorro", NOW);
    await expect(requestCaptureFromSearch(u.a, s.id, "De novo, outro pedido", NOW)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(r).toMatchObject({ searchId: s.id, status: "SEARCHING", areas: ["Centro"], propertyType: "Casa", phoneEnc: null });

    // captação vê, sem o nome do cliente; pré-atendimento não vê no radar dele
    expect(await countUnreadAlerts(danusa)).toBe(1);
    const reqs = await captureRequests(danusa, NOW);
    expect(reqs.map((x) => [x.id, x.createdBy.role])).toEqual([[r.id, "CONSULTANT"]]);
    expect(JSON.stringify(reqs)).not.toContain("Bruno");
    expect(await listRadar(jasmin, { tab: "abertos" })).toEqual([]);

    // o perfil da busca muda → o pedido acompanha
    await updateSearchProfile(u.a, s.id, { maxBudget: "2.800", areas: "Centro, Igara." });
    expect(await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ maxBudgetCents: 280000, areas: ["Centro", "Igara"] });

    // "estou buscando" e indicação → aviso para a consultora, no cliente em busca
    await setCaptureOwner(danusa, r.id, true, NOW);
    expect(await latestUnreadAlert(u.a)).toMatchObject({ title: "Danusa está buscando seu pedido", url: `/em-busca/${s.id}` });
    await captureFound(henrique, r.id, { codes: "713067" }, NOW);
    expect((await listAlerts(u.a)).map((a) => a.title)).toContain("A captação achou imóvel para o radar");
    expect(await countUnreadAlerts(jasmin)).toBe(0);
    const view = await captureForSearch(s.id);
    expect(view?.captureOwner?.name).toBe("Danusa Oliveira");
    expect(view?.indications.map((i) => [i.code, i.by.name, i.result.outcome])).toEqual([["713067", "Henrique Martins", "OFFERED"]]);

    // busca encerrada → pedido encerrado e a captação avisada
    await closeClientSearch(u.a, s.id, "GAVE_UP", "", NOW);
    expect(await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "CLOSED", closeReason: "Desistiu / parou de responder" });
    expect((await latestUnreadAlert(danusa))?.title).toBe("Pedido encerrado: pode parar a busca");
    await closeCaptureForSearch(u.a, s.id, "WON", NOW); // já encerrado: nada muda
    expect((await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } })).closeReason).toBe("Desistiu / parou de responder");
  });

  it("estou buscando: só a captação pega; quem não pegou não larga; o primeiro a indicar vira o dono", async () => {
    const r = await createRadar(jasmin, { clientName: "Rita", phone: "(51) 99876-1111", wants: "Casa com pátio", areas: "Centro", propertyType: "Casa" }, NOW);
    await expect(setCaptureOwner(u.a, r.id, true, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await captureFound(henrique, r.id, { codes: "1001" }, NOW);
    expect((await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } })).captureOwnerId).toBe(henrique.id);
    await expect(setCaptureOwner(danusa, r.id, false, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setCaptureOwner(danusa, r.id, true, NOW); // assume
    expect((await captureRequests(henrique, NOW))[0].captureOwner?.name).toBe("Danusa Oliveira");
    await setCaptureOwner(danusa, r.id, false, NOW);
    expect((await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } })).captureOwnerId).toBeNull();
  });
});

describe("retorno das indicações e placar", () => {
  it("visita marcada → visitou → alugou aparece para a captação e conta no placar do mês", async () => {
    const client = await db.client.create({ data: { name: "Rita" } });
    const r = await createRadar(jasmin, { clientName: "Rita", phone: "(51) 99876-1111", wants: "Casa com pátio", areas: "Centro", propertyType: "Casa" }, NOW);
    await db.clientRadar.update({ where: { id: r.id }, data: { clientId: client.id } });
    await captureFound(danusa, r.id, { codes: "713067; 844503" }, NOW);
    await captureFound(henrique, r.id, { codes: "900001" }, NOW);
    await db.clientRadar.update({ where: { id: r.id }, data: { rejectedCodes: ["900001"] } });
    const results = async () => Object.fromEntries((await captureRequests(danusa, NOW))[0].results.map((x) => [x.code, x.outcome]));
    expect(await results()).toEqual({ "713067": "OFFERED", "844503": "OFFERED", "900001": "REJECTED" });

    const start = new Date(NOW.getTime() + DAY);
    const visit = await db.visit.create({ data: { origin: "MANUAL", assignmentStatus: "MANUAL", clientId: client.id, clientName: "Rita", propertyCode: "713067", consultantId: u.a.id, scheduledStart: start, scheduledEnd: new Date(start.getTime() + 3600_000), status: "SCHEDULED" } });
    expect((await results())["713067"]).toBe("VISIT_SCHEDULED");
    await db.visit.update({ where: { id: visit.id }, data: { status: "DONE", evaluation: "POSITIVE", note: "gostou do pátio", concludedAt: start } });
    expect((await results())["713067"]).toBe("VISITED_LIKED");
    const property = await db.property.create({ data: { code: "713067" } });
    await db.opportunity.create({ data: { clientId: client.id, propertyId: property.id, status: "CLOSED_WON", stage: "SIGNED", signedAt: start, responsibleId: u.a.id, closedResponsibleId: u.a.id, firstDoneVisitAt: start, closedAt: start } });
    expect((await results())["713067"]).toBe("RENTED");

    await expect(captureScoreboard(u.a, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const board = await captureScoreboard(danusa, NOW);
    expect(board.label).toBe("outubro");
    expect(board.people.map((p) => [p.name, p.indicated, p.visits, p.rented])).toEqual([
      ["Danusa Oliveira", 2, 1, 1],
      ["Henrique Martins", 1, 0, 0],
    ]);
    expect(board.total).toEqual({ indicated: 3, visits: 1, rented: 1 });
    expect((await captureScoreboard(u.manager, NOW, "2026-09")).total.indicated).toBe(0);
  });

  it("bom dia das 8h: uma vez por dia, com pedidos novos, sem dono, atrasados e o retorno que mudou", async () => {
    const client = await db.client.create({ data: { name: "Rita" } });
    const old = await createRadar(jasmin, { clientName: "Rita", phone: "(51) 99876-1111", wants: "Casa com pátio", areas: "Centro" }, new Date(NOW.getTime() - 20 * DAY));
    await db.clientRadar.update({ where: { id: old.id }, data: { clientId: client.id } });
    await createRadar(jasmin, { clientName: "Ana", phone: "(51) 99876-2222", wants: "Apartamento perto do trem", areas: "Centro" }, new Date(NOW.getTime() - 3600_000));
    const other = await createRadar(jasmin, { clientName: "Lia", phone: "(51) 99876-3333", wants: "Kitnet perto da Ulbra", areas: "São José" }, new Date(NOW.getTime() - 5 * DAY));
    await captureFound(danusa, other.id, { codes: "555" }, new Date(NOW.getTime() - 2 * DAY));
    await db.clientRadar.update({ where: { id: other.id }, data: { clientId: client.id } });
    const start = new Date(NOW.getTime() + DAY);
    await db.visit.create({ data: { origin: "MANUAL", assignmentStatus: "MANUAL", clientId: client.id, clientName: "Rita", propertyCode: "555", consultantId: u.a.id, scheduledStart: start, scheduledEnd: new Date(start.getTime() + 3600_000), status: "SCHEDULED" } });

    const sent: { uid: string; body: string }[] = [];
    const notify = async (uid: string, p: { body: string }) => void sent.push({ uid, body: p.body });
    expect(await sendCaptureMorning(new Date("2026-10-28T09:00:00Z"), { notify })).toBe(0); // 6h
    expect(await sendCaptureMorning(NOW, { notify })).toBe(2);
    const forDanusa = sent.find((x) => x.uid === danusa.id)!.body;
    expect(forDanusa).toBe("1 pedido novo · 2 sem ninguém buscando · 1 esperando há 15+ dias · 555: visita marcada para 29/10");
    expect(sent.find((x) => x.uid === henrique.id)!.body).not.toContain("555");
    expect((await listAlerts(danusa)).map((a) => a.title)).toContain("Bom dia, captação");
    // mesmo dia: não repete; o retorno avisado não volta amanhã
    expect(await sendCaptureMorning(new Date(NOW.getTime() + 3600_000), { notify })).toBe(0);
    sent.length = 0;
    await sendCaptureMorning(new Date(NOW.getTime() + DAY), { notify });
    expect(sent.find((x) => x.uid === danusa.id)?.body ?? "").not.toContain("555");
  });
});
