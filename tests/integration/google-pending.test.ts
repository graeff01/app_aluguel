// Agenda Google fora do ar: o que o app não conseguiu mandar fica na fila e vai sozinho quando a agenda volta.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runSync } from "@/server/sync/engine";
import { staffEditVisit } from "@/server/staff-edit";
import { cancelVisitByStaff, reopenCanceledVisit } from "@/server/visits";
import { createVisitEventInGoogle, rescheduleVisit } from "@/server/reschedule";
import { flushGooglePending } from "@/server/google-pending";
import { toLocalInput } from "@/lib/time";
import { MockCalendar, visitEvent } from "../helpers/mock-calendar";
import { makeConnection, makeUsers, resetDb } from "../helpers/db";

const NOW = new Date("2026-10-06T15:00:00Z");
const CAL = "central@exemplo.test";
let users: Awaited<ReturnType<typeof makeUsers>>;
let api: MockCalendar;
let jasmin: { id: string; role: "PRE_SERVICE" };
const sync = () => runSync({ api, now: NOW, sleep: async () => {} });
/** Google fora: toda escrita falha (conexão expirada). */
const down = () =>
  ({
    patchEvent: async () => Promise.reject(Object.assign(new Error("token expirado"), { kind: "AUTH" })),
    insertEvent: async () => Promise.reject(Object.assign(new Error("token expirado"), { kind: "AUTH" })),
    updateSummary: async () => Promise.reject(Object.assign(new Error("token expirado"), { kind: "AUTH" })),
  }) as unknown as MockCalendar;
const pending = async (id: string) => (await db.visit.findUniqueOrThrow({ where: { id } })).googlePending.sort();
const title = (who: string, codes: string) => `Visita clt - ${who} - cod ${codes} - (51) 99876-5432`;

beforeEach(async () => {
  await resetDb();
  users = await makeUsers();
  await makeConnection(CAL);
  api = new MockCalendar();
  jasmin = { id: (await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } })).id, role: "PRE_SERVICE" };
});

describe("agenda Google fora do ar", () => {
  it("imóveis adicionados com a agenda fora vão para o título sozinhos quando ela volta (antes da leitura da agenda)", async () => {
    api.put(visitEvent("thiago", { start: "2026-10-07T16:30:00Z", title: title("Thiago Martim", "747899"), organizer: CAL }));
    await sync();
    const v = await db.visit.findFirstOrThrow();
    const base = { clientName: "Thiago Martim", phoneRaw: "(51) 99876-5432", date: "2026-10-07", time: "13:30", durationMinutes: 60, consultantId: v.consultantId ?? users.a.id };
    const r = await staffEditVisit(jasmin, v.id, { ...base, expectedVersion: v.version, addCodes: "823393;352928" }, { calendarApi: down() });
    expect(r.google).toBe("error");
    expect(await pending(v.id)).toEqual(["title"]);
    // sem agenda ainda: continua na fila
    expect(await flushGooglePending({ calendarApi: down() })).toBe(0);
    expect(await pending(v.id)).toEqual(["title"]);
    // agenda de volta
    expect(await flushGooglePending({ calendarApi: api })).toBe(1);
    expect((await api.getEvent(CAL, "thiago"))?.summary).toBe(title("Thiago Martim", "747899;823393;352928"));
    expect(await pending(v.id)).toEqual([]);
    await sync();
    expect(await db.visit.count({ where: { status: "SCHEDULED" } })).toBe(3);
  });

  it("horário mudado com a agenda fora é desfeito na hora e não entra na fila", async () => {
    api.put(visitEvent("hora", { start: "2026-10-07T16:30:00Z", title: title("Ana Souza", "111222"), organizer: CAL }));
    await sync();
    const v = await db.visit.findFirstOrThrow();
    await expect(staffEditVisit(jasmin, v.id, { expectedVersion: v.version, clientName: "Ana Souza", phoneRaw: "(51) 99876-5432", date: "2026-10-07", time: "15:00", durationMinutes: 60, consultantId: v.consultantId ?? users.a.id }, { calendarApi: down() })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).scheduledStart.toISOString()).toBe("2026-10-07T16:30:00.000Z");
    expect(await pending(v.id)).not.toContain("time");
  });

  it("visita cancelada com a agenda fora: o evento vai para as 22h quando ela volta; reaberta: volta ao horário e não é cancelada de novo", async () => {
    api.put(visitEvent("cancel", { start: "2026-10-07T17:00:00Z", title: title("Bia Lima", "333444"), organizer: CAL }));
    await sync();
    const v = await db.visit.findFirstOrThrow();
    const reason = await db.reason.findFirstOrThrow({ where: { kind: "VISIT_CANCEL" } });
    await cancelVisitByStaff(jasmin, v.id, { reasonId: reason.id }, NOW, { calendarApi: down() });
    expect(await pending(v.id)).toEqual(["cancel"]);
    await flushGooglePending({ calendarApi: api });
    expect((await api.getEvent(CAL, "cancel"))?.start?.dateTime).toBe("2026-10-08T01:00:00.000Z"); // 22h em Brasília
    expect(await pending(v.id)).toEqual([]);

    // reaberta com a agenda fora: horário e título na fila; o reenvio roda antes da leitura da agenda
    await reopenCanceledVisit(jasmin, v.id, { note: "Cancelada por engano" }, NOW, { calendarApi: down() });
    expect(await pending(v.id)).toEqual(["time", "title"]);
    await flushGooglePending({ calendarApi: api });
    expect((await api.getEvent(CAL, "cancel"))?.start?.dateTime).toBe("2026-10-07T17:00:00.000Z");
    await sync();
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("SCHEDULED");
  });

  it("visita marcada no app com a agenda fora: o evento é criado quando ela volta e a sincronização liga sem duplicar", async () => {
    api.put(visitEvent("velha", { start: "2026-10-06T13:00:00Z", title: title("Caio Reis", "555666"), attendees: ["consultora.a@exemplo.test"], organizer: CAL }));
    await sync();
    const old = await db.visit.findFirstOrThrow();
    const nv = await rescheduleVisit(users.a, old.id, { requestId: "fila-1", scheduledStart: toLocalInput(new Date("2026-10-09T17:00:00Z")), durationMinutes: 60, mode: "reschedule" }, NOW);
    expect(await createVisitEventInGoogle(users.a, nv.id, { calendarApi: down() })).toBe("error");
    expect(await pending(nv.id)).toEqual(["create"]);
    expect(await flushGooglePending({ calendarApi: api })).toBe(1);
    expect((await db.visit.findUniqueOrThrow({ where: { id: nv.id } })).googleCreatedAt).not.toBeNull();
    await sync();
    expect((await db.visit.findUniqueOrThrow({ where: { id: nv.id } })).sourceEventId).not.toBeNull();
    expect(await db.visit.count({ where: { propertyCode: "555666", status: "SCHEDULED" } })).toBe(1);
  });
});
