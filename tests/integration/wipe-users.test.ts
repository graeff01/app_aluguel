// Limpeza dos dados de teste (com trava) e reativação de usuário desativado.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runSync } from "@/server/sync/engine";
import { createManualVisit } from "@/server/visits";
import { wipeTestData, WIPE_LIMIT } from "@/server/wipe";
import { toLocalInput } from "@/lib/time";
import { makeConnection, makeUsers, resetDb } from "../helpers/db";
import { MockCalendar, visitEvent } from "../helpers/mock-calendar";

let u: Awaited<ReturnType<typeof makeUsers>>;
const NOW = new Date("2026-10-06T15:00:00Z");
const noSleep = async () => {};

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

describe("limpeza dos dados de teste", () => {
  it("só admin, com a palavra de confirmação; apaga tudo operacional e os eventos não voltam", async () => {
    await makeConnection();
    const api = new MockCalendar();
    api.put(visitEvent("t1", { start: "2026-10-06T13:00:00Z" }));
    await runSync({ api, now: NOW, sleep: noSleep });
    await createManualVisit(u.admin, { requestId: "wipe-manual-req", scheduledStart: toLocalInput(NOW), clientName: "Cliente Manual", phoneRaw: "(51) 99876-7777", propertyCode: "123", consultantId: u.a.id });
    expect(await db.visit.count()).toBe(2);

    await expect(wipeTestData(u.manager, "APAGAR")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(wipeTestData(u.admin, "apagar tudo")).rejects.toMatchObject({ code: "VALIDATION" });
    const d = await wipeTestData(u.admin, "apagar", NOW);
    expect(d).toMatchObject({ visitas: 2, eventosIgnorados: 1 });
    expect(await db.visit.count()).toBe(0);
    expect(await db.client.count()).toBe(0);
    expect(await db.property.count()).toBe(0);
    expect(await db.user.count()).toBe(4); // usuários mantidos
    expect(await db.sourceEvent.findFirst()).toMatchObject({ title: null, description: null });

    // o evento continua no Google: nova sincronização (inclusive completa) não recria a visita
    api.put(visitEvent("t1", { start: "2026-10-06T13:30:00Z" }));
    await runSync({ api, now: NOW, sleep: noSleep });
    await runSync({ api, now: NOW, full: true, sleep: noSleep });
    expect(await db.visit.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "data.test_wipe" } })).toBe(1);
  });

  it("bloqueada quando o app já está em uso real", async () => {
    const start = new Date("2026-10-01T12:00:00Z");
    await db.visit.createMany({
      data: Array.from({ length: WIPE_LIMIT + 1 }, (_, i) => ({ origin: "MANUAL" as const, assignmentStatus: "MANUAL" as const, scheduledStart: new Date(start.getTime() + i * 3600_000), scheduledEnd: new Date(start.getTime() + i * 3600_000 + 1800_000) })),
    });
    await expect(wipeTestData(u.admin, "APAGAR")).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await db.visit.count()).toBe(WIPE_LIMIT + 1);
  });
});
