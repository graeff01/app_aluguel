// Lembretes diários e encadeamento de pendências (Postgres real; envio de notificação SIMULADO).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sendDailyReminders, type Sender } from "@/server/reminders";
import { nextPending } from "@/server/queries";
import { createManualVisit } from "@/server/visits";
import { toLocalInput } from "@/lib/time";
import { csvCell } from "@/lib/csv";
import type { AuthzActor } from "@/lib/authz";
import { makeUsers, resetDb } from "../helpers/db";

// Terça 06/10/2026 10:00 em São Paulo
const NOW = new Date("2026-10-06T13:00:00Z");
let u: Awaited<ReturnType<typeof makeUsers>>;
let seq = 0;
const visitAt = (actor: AuthzActor, consultantId: string, hoursAgo: number, name = "Cliente Sintético") =>
  createManualVisit(actor, { requestId: `rem-${++seq}-req`, scheduledStart: toLocalInput(new Date(NOW.getTime() - hoursAgo * 3600_000)), clientName: name, phoneRaw: "", propertyCode: "1", consultantId });

function fakeSender() {
  const sent: { endpoint: string; title: string; body: string; url: string }[] = [];
  const send: Sender = async (t, p) => {
    if (t.endpoint.includes("expirado")) return "gone";
    sent.push({ endpoint: t.endpoint, ...p });
    return "ok";
  };
  return { sent, send };
}
const sub = (userId: string, name: string) => db.pushSubscription.create({ data: { userId, endpoint: `https://push.exemplo.test/${name}`, p256dh: "chave-publica-sintetica", auth: "auth-sintetico" } });

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  await db.appSettings.update({ where: { id: 1 }, data: { reminderHour: 9, remindersEnabled: true } });
});

describe("lembretes diários", () => {
  it("consultora recebe só a contagem das próprias pendências > 24 h; gestora recebe resumo; uma vez por dia", async () => {
    await visitAt(u.admin, u.a.id, 30, "Fulana Confidencial");
    await visitAt(u.admin, u.a.id, 50);
    await visitAt(u.admin, u.a.id, 3); // < 24 h: não conta
    await visitAt(u.admin, u.b.id, 26);
    await sub(u.a.id, "a");
    await sub(u.b.id, "b");
    await sub(u.manager.id, "gestora");
    const { sent, send } = fakeSender();

    await sendDailyReminders(NOW, { send });
    const forA = sent.find((s) => s.endpoint.endsWith("/a"))!;
    expect(forA.title).toBe("2 visitas aguardando resultado");
    expect(JSON.stringify(sent)).not.toContain("Fulana"); // sem dados de cliente
    expect(sent.find((s) => s.endpoint.endsWith("/b"))!.title).toBe("1 visita aguardando resultado");
    const mgr = sent.find((s) => s.endpoint.endsWith("/gestora"))!;
    expect(mgr.title).toBe("Equipe: 3 visitas sem registro há mais de 24 h");
    expect(mgr.body).toBe("Consultora 2 · Consultora 1");
    expect(sent).toHaveLength(3);

    await sendDailyReminders(new Date(NOW.getTime() + 3600_000), { send });
    expect(sent).toHaveLength(3); // não repete no mesmo dia
  });

  it("respeita horário, domingo e desativação; apaga inscrição expirada", async () => {
    await visitAt(u.admin, u.a.id, 30);
    await sub(u.a.id, "expirado");
    const { sent, send } = fakeSender();
    expect(await sendDailyReminders(new Date("2026-10-06T10:00:00Z"), { send })).toEqual({ skipped: "NOT_TIME" }); // 07:00
    expect(await sendDailyReminders(new Date("2026-10-11T13:00:00Z"), { send })).toEqual({ skipped: "NOT_TIME" }); // domingo
    await db.appSettings.update({ where: { id: 1 }, data: { remindersEnabled: false } });
    expect(await sendDailyReminders(NOW, { send })).toEqual({ skipped: "DISABLED" });
    await db.appSettings.update({ where: { id: 1 }, data: { remindersEnabled: true } });
    await sendDailyReminders(NOW, { send });
    expect(sent).toHaveLength(0);
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("sem pendências, ninguém é notificado", async () => {
    await sub(u.a.id, "a");
    await sub(u.manager.id, "g");
    const { sent, send } = fakeSender();
    await sendDailyReminders(NOW, { send });
    expect(sent).toHaveLength(0);
  });
});

describe("próxima pendente", () => {
  it("devolve a mais antiga da própria consultora, excluindo a atual", async () => {
    const v1 = await visitAt(u.admin, u.a.id, 50);
    const v2 = await visitAt(u.admin, u.a.id, 30);
    await visitAt(u.admin, u.b.id, 70); // de outra consultora
    const n = await nextPending(u.a, v1.id, NOW);
    expect(n).toEqual({ id: v2.id, remaining: 1 });
    expect(await nextPending(u.a, v2.id, NOW)).toEqual({ id: v1.id, remaining: 1 });
    await db.visit.update({ where: { id: v2.id }, data: { status: "NO_SHOW", note: "x" } });
    expect(await nextPending(u.a, v1.id, NOW)).toBeNull();
  });
});

describe("CSV", () => {
  it("neutraliza fórmulas e escapa separadores", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+5551")).toBe("'+5551");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell("linha\nquebrada")).toBe('"linha\nquebrada"');
    expect(csvCell(null)).toBe("");
  });
});
