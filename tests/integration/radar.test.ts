// Radar de clientes: pedidos do pré-atendimento à captação, cobrança, atualização, encerramento e LGPD.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { closeRadar, countDueRadar, createRadar, listRadar, radarDetail, reopenRadar, runRadarRetention, updateRadar } from "@/server/radar";
import { sendOperationalAlerts } from "@/server/reminders";
import { makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
const NOW = new Date("2026-10-27T15:00:00Z"); // terça
const DAY = 24 * 3600_000;
const valid = (o: Partial<Parameters<typeof createRadar>[1]> = {}) => ({
  clientName: "Rita Procura",
  phone: "(51) 99876-1111",
  wants: "Casa com pátio para cachorro no Centro",
  maxBudget: "2.500",
  areas: "Centro, Marechal Rondon",
  propertyType: "Casa",
  bedrooms: "2",
  sentToCapture: true,
  ...o,
});

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  const j = await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } });
  jasmin = { id: j.id, role: "PRE_SERVICE" };
});

describe("radar de clientes", () => {
  it("pré-atendimento cadastra (telefone cifrado, perfil), cobra no dia, atualiza com imóveis achados e encerra", async () => {
    await expect(createRadar(u.a, valid(), NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createRadar(jasmin, valid({ phone: "123", wants: "" }), NOW)).rejects.toMatchObject({ code: "VALIDATION", details: { wants: expect.any(String) } });
    await expect(createRadar(jasmin, valid({ phone: "123" }), NOW)).rejects.toMatchObject({ details: { phone: expect.any(String) } });

    const r = await createRadar(jasmin, valid({ requestId: "radar-1" }), NOW);
    expect(await createRadar(jasmin, valid({ requestId: "radar-1" }), NOW)).toMatchObject({ id: r.id }); // toque duplo não duplica
    const raw = await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } });
    expect(raw.phoneEnc).not.toContain("99876");
    expect(raw).toMatchObject({ status: "SEARCHING", maxBudgetCents: 250000, areas: ["Centro", "Marechal Rondon"], propertyType: "Casa", bedrooms: 2 });
    expect(raw.sentToCaptureAt).toEqual(NOW);
    expect((await radarDetail(u.manager, r.id)).phone).toBe("+5551998761111");
    await expect(radarDetail(u.a, r.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // cobrar: 3 dias depois aparece em "Cobrar hoje" e no número do menu
    expect(await countDueRadar(jasmin, NOW)).toBe(0);
    const later = new Date(NOW.getTime() + 3 * DAY);
    expect(await countDueRadar(jasmin, later)).toBe(1);
    expect((await listRadar(jasmin, { tab: "cobrar" }, later)).map((x) => x.id)).toEqual([r.id]);

    // aviso diário ao pré-atendimento (sem dados do cliente)
    await db.pushSubscription.create({ data: { userId: jasmin.id, endpoint: "https://push.test/j", p256dh: "k", auth: "a" } });
    await db.appSettings.update({ where: { id: 1 }, data: { remindersEnabled: true } });
    const sent: { title: string; body: string }[] = [];
    await sendOperationalAlerts(later, { send: async (_t, p) => (sent.push(p), "ok"), email: null });
    const alert = sent.find((p) => /radar/.test(p.title));
    expect(alert?.title).toBe("1 cliente do radar para cobrar hoje");
    expect(JSON.stringify(alert)).not.toContain("Rita");

    // atualização: captação achou dois imóveis; cobra de novo em 2 dias
    await expect(updateRadar(jasmin, r.id, { note: "" }, later)).rejects.toMatchObject({ code: "VALIDATION" });
    await updateRadar(jasmin, r.id, { note: "Captação mandou duas opções", foundCodes: "734999; 812001", followUpDays: 2 }, later);
    const upd = await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } });
    expect(upd).toMatchObject({ status: "FOUND", foundCodes: ["734999", "812001"] });
    expect(await countDueRadar(jasmin, later)).toBe(0);
    expect((await listRadar(jasmin, { tab: "abertos", q: "812001" }, later)).length).toBe(1);

    // encerra com o resultado; reabrir volta a "imóvel encontrado"
    await expect(closeRadar(jasmin, r.id, { reason: "qualquer" }, later)).rejects.toMatchObject({ code: "VALIDATION" });
    await closeRadar(jasmin, r.id, { reason: "Agendou visita", note: "visita sexta" }, later);
    await expect(updateRadar(jasmin, r.id, { note: "depois de fechado" }, later)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await listRadar(jasmin, { tab: "encerrados" }, later)).map((x) => x.closeReason)).toEqual(["Agendou visita"]);
    await reopenRadar(jasmin, r.id, later);
    expect(await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "FOUND", closeReason: null });
    const events = await db.radarEvent.findMany({ where: { radarId: r.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.note)).toEqual([
      "Cadastrado no radar e passado à captação.",
      "Captação achou: 734999, 812001. — Captação mandou duas opções",
      "Encerrado: Agendou visita — visita sexta",
      "Reaberto.",
    ]);
  });

  it("LGPD: telefone de pedido encerrado é apagado no prazo; aberto fica", async () => {
    const open = await createRadar(jasmin, valid({ clientName: "Aberto" }), NOW);
    const done = await createRadar(jasmin, valid({ clientName: "Fechado" }), NOW);
    await closeRadar(jasmin, done.id, { reason: "Desistiu / parou de responder" }, NOW);
    const settings = await db.appSettings.findUniqueOrThrow({ where: { id: 1 } });
    await runRadarRetention(new Date(NOW.getTime() + (settings.preAnalysisRetentionDays + 1) * DAY));
    expect((await db.clientRadar.findUniqueOrThrow({ where: { id: done.id } })).phoneEnc).toBeNull();
    expect((await db.clientRadar.findUniqueOrThrow({ where: { id: open.id } })).phoneEnc).not.toBeNull();
    await expect(reopenRadar(jasmin, done.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
