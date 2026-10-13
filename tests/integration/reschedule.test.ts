// Reagendamento pela consultora: nova visita no app, link do Google preenchido e ligação pelo código (sem duplicar).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { calendarLinkFor, LINK_CODE_RE, rescheduleVisit } from "@/server/reschedule";
import { concludeVisit, createManualVisit } from "@/server/visits";
import { refreshPropertyNow } from "@/server/property-preview";
import { runSync } from "@/server/sync/engine";
import { toLocalInput } from "@/lib/time";
import { makeConnection, makeUsers, resetDb } from "../helpers/db";
import { MockCalendar, visitEvent } from "../helpers/mock-calendar";

let u: Awaited<ReturnType<typeof makeUsers>>;
const NOW = new Date("2026-10-13T15:00:00Z"); // 12:00 SP
const local = (iso: string) => toLocalInput(new Date(iso));

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

describe("reagendar", () => {
  it("remarca a atual, cria a nova com os mesmos dados e é idempotente", async () => {
    const old = await createManualVisit(u.admin, { requestId: "resch-old-req", scheduledStart: local("2026-10-13T17:00:00Z"), clientName: "Cliente Remarca", phoneRaw: "(51) 99876-5555", propertyCode: "761739", consultantId: u.a.id });
    await expect(rescheduleVisit(u.b, old.id, { requestId: "x1", scheduledStart: local("2026-10-14T18:00:00Z"), durationMinutes: 60, mode: "reschedule" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(rescheduleVisit(u.a, old.id, { requestId: "x2", scheduledStart: local("2026-10-12T18:00:00Z"), durationMinutes: 60, mode: "reschedule" }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    const input = { requestId: "abc", scheduledStart: local("2026-10-14T18:00:00Z"), durationMinutes: 45, mode: "reschedule" as const, note: "cliente pediu" };
    const nv = await rescheduleVisit(u.a, old.id, input, NOW);
    expect(nv).toMatchObject({ clientName: "Cliente Remarca", propertyCode: "761739", consultantId: u.a.id, rescheduledFromId: old.id, scheduledById: u.a.id, status: "SCHEDULED", origin: "MANUAL" });
    expect(nv.linkCode).toMatch(LINK_CODE_RE);
    expect(nv.scheduledEnd.getTime() - nv.scheduledStart.getTime()).toBe(45 * 60_000);
    const o = await db.visit.findUniqueOrThrow({ where: { id: old.id } });
    expect(o.status).toBe("RESCHEDULED");
    expect(o.note).toMatch(/^Remarcada para .* — cliente pediu$/);
    expect((await rescheduleVisit(u.a, old.id, input, NOW)).id).toBe(nv.id); // reenvio não duplica
    expect(await db.visit.count()).toBe(2);
  });

  it("nova visita exige o resultado da atual antes", async () => {
    const v = await createManualVisit(u.admin, { requestId: "resch-need-req", scheduledStart: local("2026-10-13T17:00:00Z"), clientName: "Cliente Antes", phoneRaw: "", propertyCode: "761739", consultantId: u.a.id });
    await expect(rescheduleVisit(u.a, v.id, { requestId: "n0", scheduledStart: local("2026-10-15T18:00:00Z"), durationMinutes: 60, mode: "new" }, NOW)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("nova visita para o mesmo cliente mantém a anterior", async () => {
    const old = await createManualVisit(u.admin, { requestId: "resch-done-req", scheduledStart: local("2026-10-12T17:00:00Z"), clientName: "Cliente Volta", phoneRaw: "(51) 99876-6666", propertyCode: "761739", consultantId: u.a.id });
    await concludeVisit(u.a, old.id, { requestId: "resch-done-c", expectedVersion: 1, status: "DONE", evaluation: "UNDECIDED", note: "vai pensar" }, NOW);
    const nv = await rescheduleVisit(u.a, old.id, { requestId: "new1", scheduledStart: local("2026-10-15T18:00:00Z"), durationMinutes: 60, mode: "reschedule" }, NOW);
    expect((await db.visit.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("DONE"); // já tinha resultado: não muda
    expect(nv.clientId).toBe(old.clientId);
    expect(nv.assignmentNote).toBe("NOVA_VISITA_MESMO_CLIENTE");
    // sem a etiqueta REAGENDADA no título (é revisita, não remarcação)
    await makeConnection();
    expect(new URL((await calendarLinkFor(u.a, nv.id)).url).searchParams.get("text")).not.toContain("REAGENDADA");
  });
});

describe("agenda Google", () => {
  it("link preenchido no padrão, com a conta central e o código; evento com o código liga sem duplicar", async () => {
    const conn = await makeConnection();
    const old = await createManualVisit(u.admin, { requestId: "resch-cal-req", scheduledStart: local("2026-10-13T17:00:00Z"), clientName: "Cliente Agenda", phoneRaw: "(51) 99876-7777", propertyCode: "654321", consultantId: u.a.id });
    const nv = await rescheduleVisit(u.a, old.id, { requestId: "cal1", scheduledStart: local("2026-10-14T18:00:00Z"), durationMinutes: 60, mode: "reschedule" }, NOW);
    const cal = await calendarLinkFor(u.a, nv.id);
    const url = new URL(cal.url);
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("text")).toBe("Visita clt - Cliente Agenda - cod 654321 - (51) 99876-7777 - REAGENDADA");
    expect(url.searchParams.get("dates")).toBe("20261014T180000Z/20261014T190000Z");
    expect(url.searchParams.get("add")).toBe(conn.calendarId);
    expect(url.searchParams.get("details")).toContain(nv.linkCode!);
    expect(cal.linked).toBe(false);

    // a consultora salva no Google (organizadora = ela); a conta central recebe o convite
    const api = new MockCalendar();
    api.put(visitEvent("novo", { title: url.searchParams.get("text")!, start: "2026-10-14T18:30:00Z", description: url.searchParams.get("details")!, organizer: "consultora.a@exemplo.test", attendees: ["agenda.central@exemplo.test"] }));
    await runSync({ api, now: NOW, sleep: async () => {} });
    expect(await db.visit.count()).toBe(2); // não duplicou
    const linked = await db.visit.findUniqueOrThrow({ where: { id: nv.id } });
    expect(linked.sourceEventId).not.toBeNull();
    expect(linked.scheduledStart.toISOString()).toBe("2026-10-14T18:30:00.000Z"); // horário que ela salvou
    expect(linked.consultantId).toBe(u.a.id);
    expect((await calendarLinkFor(u.a, nv.id)).linked).toBe(true);
  });

  it("apagar no Google o evento de uma visita já remarcada não gera conflito", async () => {
    await makeConnection();
    const api = new MockCalendar();
    api.put(visitEvent("velho", { start: "2026-10-13T17:00:00Z" }));
    await runSync({ api, now: NOW, sleep: async () => {} });
    const old = await db.visit.findFirstOrThrow();
    await rescheduleVisit(u.a, old.id, { requestId: "del1", scheduledStart: local("2026-10-14T18:00:00Z"), durationMinutes: 60, mode: "reschedule" }, NOW);
    api.cancel("velho");
    await runSync({ api, now: NOW, sleep: async () => {} });
    expect(await db.visit.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ status: "RESCHEDULED", syncConflict: "NONE" });
  });
});

describe("reagendar para outro imóvel e cópia configurada", () => {
  it("troca o código do imóvel mantendo o cliente; convidados incluem as cópias configuradas", async () => {
    const conn = await makeConnection();
    await db.appSettings.update({ where: { id: 1 }, data: { calendarCcEmails: "pre@exemplo.test, outra@exemplo.test" } });
    const old = await createManualVisit(u.admin, { requestId: "resch-prop-req", scheduledStart: local("2026-10-13T17:00:00Z"), clientName: "Cliente Troca", phoneRaw: "(51) 99876-8888", propertyCode: "111111", consultantId: u.a.id });
    await expect(rescheduleVisit(u.a, old.id, { requestId: "p0", scheduledStart: local("2026-10-14T18:00:00Z"), durationMinutes: 60, mode: "reschedule", propertyCode: "!!" }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    const nv = await rescheduleVisit(u.a, old.id, { requestId: "p1", scheduledStart: local("2026-10-14T18:00:00Z"), durationMinutes: 60, mode: "reschedule", propertyCode: " 222222 " }, NOW);
    expect(nv).toMatchObject({ propertyCode: "222222", clientId: old.clientId, clientName: "Cliente Troca" });
    expect(nv.propertyId).not.toBe(old.propertyId);
    expect((await db.visit.findUniqueOrThrow({ where: { id: old.id } })).note).toContain("(imóvel 222222)");
    const url = new URL((await calendarLinkFor(u.a, nv.id)).url);
    expect(url.searchParams.get("text")).toContain("cod 222222");
    expect(url.searchParams.get("add")).toBe(`${conn.calendarId},pre@exemplo.test,outra@exemplo.test`);
  });
});

describe("status da visita atual ao reagendar", () => {
  it("aconteceu → registra o resultado da atual e cria revisita; não compareceu → remarcação", async () => {
    const a1 = await createManualVisit(u.admin, { requestId: "out-done-req", scheduledStart: local("2026-10-13T13:00:00Z"), clientName: "Cliente Aconteceu", phoneRaw: "(51) 99876-1212", propertyCode: "761739", consultantId: u.a.id });
    await expect(rescheduleVisit(u.a, a1.id, { requestId: "o1x", scheduledStart: local("2026-10-15T18:00:00Z"), durationMinutes: 60, mode: "reschedule", outcome: { status: "DONE", evaluation: "UNDECIDED", note: "" } }, NOW)).rejects.toMatchObject({ code: "VALIDATION" }); // observação obrigatória
    const n1 = await rescheduleVisit(u.a, a1.id, { requestId: "o1", scheduledStart: local("2026-10-15T18:00:00Z"), durationMinutes: 60, mode: "reschedule", propertyCode: "222222", outcome: { status: "DONE", evaluation: "UNDECIDED", note: "Quer ver outro no mesmo bairro" } }, NOW);
    expect(await db.visit.findUniqueOrThrow({ where: { id: a1.id } })).toMatchObject({ status: "DONE", evaluation: "UNDECIDED", note: "Quer ver outro no mesmo bairro" });
    expect(n1).toMatchObject({ assignmentNote: "NOVA_VISITA_MESMO_CLIENTE", propertyCode: "222222" });

    const a2 = await createManualVisit(u.admin, { requestId: "out-ns-req", scheduledStart: local("2026-10-13T13:00:00Z"), clientName: "Cliente Faltou", phoneRaw: "", propertyCode: "761739", consultantId: u.a.id });
    const n2 = await rescheduleVisit(u.a, a2.id, { requestId: "o2", scheduledStart: local("2026-10-15T18:00:00Z"), durationMinutes: 60, mode: "reschedule", outcome: { status: "NO_SHOW", note: "Não atendeu" } }, NOW);
    expect((await db.visit.findUniqueOrThrow({ where: { id: a2.id } })).status).toBe("NO_SHOW");
    expect(n2.assignmentNote).toBe("REAGENDADA");
  });

  it("visita que ainda não começou só pode ser remarcada", async () => {
    const fut = await createManualVisit(u.admin, { requestId: "out-fut-req", scheduledStart: local("2026-10-13T20:00:00Z"), clientName: "Cliente Futuro", phoneRaw: "", propertyCode: "761739", consultantId: u.a.id });
    await expect(rescheduleVisit(u.a, fut.id, { requestId: "o3", scheduledStart: local("2026-10-15T18:00:00Z"), durationMinutes: 60, mode: "reschedule", outcome: { status: "DONE", evaluation: "POSITIVE", note: "x" } }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("dados do imóvel na hora", () => {
  it("busca e salva foto, título, bairro e valores do anúncio", async () => {
    const html = `<html><head><meta property="og:title" content="Apartamento para alugar em Igara, Canoas."><meta property="og:image" content="https://img.test/9.jpg"><script type="application/ld+json">${JSON.stringify({ offers: [{ price: 1800, itemOffered: { name: "Apartamento - Igara - Canoas" }, priceSpecification: [{ name: "Total", price: 2300 }] }] })}</script></head></html>`;
    const f = (async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    await refreshPropertyNow("333333", { fetchImpl: f });
    expect(await db.property.findUniqueOrThrow({ where: { code: "333333" } })).toMatchObject({ photoUrl: "https://img.test/9.jpg", neighborhood: "Igara", rent: 1800, totalPrice: 2300, pageStatus: "OK" });
  });
});
