// Lembrete antes da visita (envio SIMULADO) e registro antes do horário.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { concludeVisit, createManualVisit } from "@/server/visits";
import { sendUpcomingVisitReminders, type Sender } from "@/server/reminders";
import { toLocalInput } from "@/lib/time";
import { makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
let seq = 0;
const NOW = new Date("2026-10-09T15:00:00Z"); // 12:00 em São Paulo
const at = (min: number, consultantId: string, name = "Cliente Secreto") =>
  createManualVisit(u.admin, { requestId: `up-${++seq}-req`, scheduledStart: toLocalInput(new Date(NOW.getTime() + min * 60_000)), clientName: name, phoneRaw: "", propertyCode: "761739", consultantId });

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  await db.appSettings.update({ where: { id: 1 }, data: { upcomingReminderMinutes: 60, remindersEnabled: true } });
});

describe("lembrete antes da visita", () => {
  it("avisa a consultora uma vez, dentro da antecedência, sem nome do cliente", async () => {
    await at(50, u.a.id);
    await at(180, u.a.id); // fora da janela
    const canceled = await at(30, u.a.id);
    await concludeVisit(u.admin, canceled.id, { requestId: "up-cancel-req", expectedVersion: 1, status: "CANCELED", note: "cliente desmarcou" }, NOW);
    await at(40, u.b.id);
    await db.pushSubscription.createMany({ data: [
      { userId: u.a.id, endpoint: "https://push.test/a", p256dh: "chave-sintetica", auth: "auth-sint" },
      { userId: u.b.id, endpoint: "https://push.test/b", p256dh: "chave-sintetica", auth: "auth-sint" },
    ] });
    const sent: { endpoint: string; title: string; body: string }[] = [];
    const send: Sender = async (t, p) => (sent.push({ endpoint: t.endpoint, ...p }), "ok");
    await sendUpcomingVisitReminders(NOW, { send, email: null });
    expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push.test/a", "https://push.test/b"]);
    expect(sent.find((s) => s.endpoint.endsWith("/a"))!.title).toBe("Visita às 12:50 · imóvel 761739");
    expect(JSON.stringify(sent)).not.toContain("Secreto");
    await sendUpcomingVisitReminders(new Date(NOW.getTime() + 60_000), { send, email: null });
    expect(sent).toHaveLength(2); // não repete
  });

  it("antecedência 0 desliga", async () => {
    await db.appSettings.update({ where: { id: 1 }, data: { upcomingReminderMinutes: 0 } });
    await at(20, u.a.id);
    expect(await sendUpcomingVisitReminders(NOW, { send: async () => "ok", email: null })).toEqual({ skipped: "DISABLED" });
  });
});

describe("registro antes do horário", () => {
  it("cancelar e remarcar são aceitos antes; realizada e não compareceu são recusadas", async () => {
    const v = await at(300, u.a.id);
    await expect(concludeVisit(u.a, v.id, { requestId: "early-done-req", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "x" }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(concludeVisit(u.a, v.id, { requestId: "early-noshow-req", expectedVersion: 1, status: "NO_SHOW", note: "x" }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    const r = await concludeVisit(u.a, v.id, { requestId: "early-resched-req", expectedVersion: 1, status: "RESCHEDULED", note: "cliente pediu outro dia" }, NOW);
    expect(r.visit.status).toBe("RESCHEDULED");
  });
});
