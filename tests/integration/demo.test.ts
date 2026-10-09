// Dados de demonstração: criados pelo admin, nomes realistas, sem notificações, fora dos relatórios; remoção completa.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { countDemoVisits, createDemoData, removeDemoData } from "@/server/demo";
import { sendResultReminders, sendUpcomingVisitReminders, type Sender } from "@/server/reminders";
import { propertyHealth } from "@/server/thermometer";
import { listMine } from "@/server/queries";
import { liveBoard } from "@/server/live";
import { createManualVisit } from "@/server/visits";
import { toLocalInput } from "@/lib/time";
import { makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
const NOW = new Date("2026-10-09T19:40:00Z"); // 16:40 em São Paulo

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  await db.appSettings.update({ where: { id: 1 }, data: { remindersEnabled: true, upcomingReminderMinutes: 240 } });
});

describe("demonstração", () => {
  it("só admin cria; nomes sem marca; aparece para a consultora; sem notificações nem termômetro; remoção completa", async () => {
    await expect(createDemoData(u.manager, u.a.id, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createDemoData(u.admin, u.manager.id, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    // uma visita real da mesma consultora (deve continuar intacta)
    const real = await createManualVisit(u.admin, { requestId: "real-visit-req", scheduledStart: toLocalInput(new Date(NOW.getTime() + 30 * 60_000)), clientName: "Cliente Real", phoneRaw: "", propertyCode: "999", consultantId: u.a.id });

    expect(await createDemoData(u.admin, u.a.id, NOW)).toBe(10);
    await expect(createDemoData(u.admin, u.a.id, NOW)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await countDemoVisits()).toBe(10);
    const names = (await db.visit.findMany({ where: { consultantId: u.a.id }, select: { clientName: true } })).map((v) => v.clientName);
    expect(names.every((n) => !n?.startsWith("[DEMO]"))).toBe(true);

    const mine = await listMine(u.a, NOW);
    expect(mine.awaiting.length).toBeGreaterThanOrEqual(2);
    expect(mine.upcoming.some((v) => v.scheduledStart <= NOW)).toBe(true); // em andamento
    expect(mine.done.length).toBeGreaterThanOrEqual(2);
    expect((await liveBoard(u.manager, NOW)).rows.find((r) => r.id === u.a.id)!.total).toBeGreaterThanOrEqual(5);

    await db.pushSubscription.create({ data: { userId: u.a.id, endpoint: "https://push.test/a", p256dh: "chave-sintetica", auth: "auth-sint" } });
    const sent: string[] = [];
    const send: Sender = async (_t, p) => (sent.push(p.title), "ok");
    await sendUpcomingVisitReminders(NOW, { send, email: null });
    await sendResultReminders(NOW, { send, email: null });
    expect(sent).toEqual(["Visita às 17:10 · imóvel 999"]); // só a visita real
    expect((await propertyHealth(u.manager, { now: NOW })).rows).toHaveLength(0);

    expect(await removeDemoData(u.admin)).toBe(10);
    expect(await countDemoVisits()).toBe(0);
    expect(await db.visit.findUnique({ where: { id: real.id } })).not.toBeNull();
    expect(await db.client.count({ where: { name: { in: ["Mariana Alves", "Felipe Moraes"] } } })).toBe(0);
    expect(await db.opportunity.count()).toBe(0);
  });
});
