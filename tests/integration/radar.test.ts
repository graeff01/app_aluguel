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

describe("radar: opções parecidas no site", () => {
  it("busca por bairro com o perfil, filtra tipo/valor/quartos, ordena e não repete os já indicados; site fora → aviso", async () => {
    const { similarOnSite, addSuggestedToRadar } = await import("@/server/radar");
    const ORIGIN = "https://www.auxiliadorapredial.com.br";
    const item = (codigo: string, cat: string, dorm: string, valor: number, total: number, bairro: string) => ({ codigo, categoria: { nome: cat }, dormitorios: dorm, valores: { valor, valorTotal: total }, endereco: { bairro: { nome: bairro } }, fotos: [] });
    const html = (items: unknown[]) => `<script>self.__next_f.push([1,${JSON.stringify(`1e:${JSON.stringify(["$", "$L1f", null, { initialData: items, totalItems: items.length }])}`)}])</script>`;
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      const list = url.includes("+centro")
        ? [item("1001", "Casa", "2", 2000, 2300, "Centro"), item("1002", "Casa", "1", 1500, 1600, "Centro"), item("1003", "Apartamento", "2", 1800, 2000, "Centro"), item("1004", "Casa", "3", 2600, 2700, "Centro"), item("1005", "Casa", "2", 3000, 3400, "Centro")]
        : [item("2001", "Casa", "2", 2100, 2200, "Igara")];
      return new Response(html(list), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await createRadar(jasmin, valid({ areas: "Centro, Igara", propertyType: "Casa", bedrooms: "2", maxBudget: "2.500" }), NOW);
    const radar = await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } });
    await expect(similarOnSite(u.a, radar, { fetchImpl, origin: ORIGIN })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const s = await similarOnSite(jasmin, radar, { fetchImpl, origin: ORIGIN });
    expect(urls.some((x) => x === `${ORIGIN}/alugar/residencial/rs+canoas+centro?tipoImovel=casa&quartos=2&valorMax=2500`)).toBe(true);
    // 1002: 1 quarto; 1003: apartamento; 1005: acima de 10% do valor → fora. 1004: 2.700 (até 10% acima) entra depois
    expect(s.items.map((x) => x.code)).toEqual(["2001", "1001", "1004"]);
    expect(s.items[0].reasons).toEqual(["dentro do valor", "no Igara", "2 quartos"]);
    // indicado ao cliente: vai para os imóveis do pedido e some das sugestões
    await addSuggestedToRadar(jasmin, r.id, "1001", NOW);
    const after = await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.foundCodes).toEqual(["1001"]);
    expect((await similarOnSite(jasmin, after, { fetchImpl, origin: ORIGIN })).items.map((x) => x.code)).not.toContain("1001");
    // site fora do ar
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const other = await createRadar(jasmin, valid({ areas: "Niterói", bedrooms: "4" }), NOW);
    expect((await similarOnSite(jasmin, await db.clientRadar.findUniqueOrThrow({ where: { id: other.id } }), { fetchImpl: down, origin: ORIGIN })).error).toBe(true);
  });
});
