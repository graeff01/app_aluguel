// Site da imobiliária: vigia do radar/clientes em busca, anúncio que saiu antes da visita, opções enviadas e mapa da demanda.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createRadar } from "@/server/radar";
import { radarOptionsSent } from "@/server/radar";
import { searchOptionsSent } from "@/server/client-search";
import { checkVisitListings, diffSeen, profileTypeOf, watchDemandOnSite } from "@/server/site-watch";
import { clearSiteCache } from "@/server/site-search";
import { captureBrief, demandMap, segmentSupply } from "@/server/demand";
import { optionsMessage } from "@/lib/options-message";
import { makeUsers, resetDb } from "../helpers/db";

const ORIGIN = "https://www.auxiliadorapredial.com.br";
const NOW = new Date("2026-10-28T13:00:00Z"); // 10h em Brasília
const DAY = 86400_000;
let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };

const item = (codigo: string, cat: string, dorm: string, valor: number, total: number, bairro: string) => ({ codigo, categoria: { nome: cat }, dormitorios: dorm, valores: { valor, valorTotal: total }, endereco: { bairro: { nome: bairro } }, fotos: [] });
const page = (items: unknown[], total = items.length) => `<script>self.__next_f.push([1,${JSON.stringify(`1e:${JSON.stringify(["$", "$L1f", null, { initialData: items, totalItems: total }])}`)}])</script>`;
/** Site falso: lista por bairro (a cada chamada pode mudar). */
const fakeSite = (byUrl: (url: string) => unknown[] | number) =>
  (async (url: string) => {
    const r = byUrl(url);
    return typeof r === "number" ? new Response("", { status: r }) : new Response(page(r), { status: 200 });
  }) as unknown as typeof fetch;

beforeEach(async () => {
  await resetDb();
  clearSiteCache();
  u = await makeUsers();
  const j = await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } });
  jasmin = { id: j.id, role: "PRE_SERVICE" };
});

describe("vigia do site", () => {
  it("radar e cliente em busca: 1ª conferência só guarda; imóvel que aparece depois vira novo e avisa quem cuida", async () => {
    const r = await createRadar(jasmin, { clientName: "Rita", phone: "(51) 99876-1111", wants: "Casa com pátio", areas: "Centro", propertyType: "Casa", bedrooms: "2", maxBudget: "2.500" }, NOW);
    const client = await db.client.create({ data: { name: "Bruno Busca" } });
    await db.visit.create({ data: { origin: "MANUAL", assignmentStatus: "MANUAL", clientId: client.id, clientName: "Bruno Busca", propertyCode: "3001", consultantId: u.a.id, scheduledStart: new Date(NOW.getTime() - 5 * DAY), scheduledEnd: new Date(NOW.getTime() - 5 * DAY + 3600_000), status: "DONE", evaluation: "UNDECIDED", note: "não gostou", concludedAt: new Date(NOW.getTime() - 5 * DAY) } });
    const s = await db.clientSearch.create({ data: { clientId: client.id, consultantId: u.a.id, createdById: u.a.id, areas: ["Igara"], propertyType: "Apartamento", maxBudgetCents: 200000 } });
    await db.clientSearch.create({ data: { clientId: (await db.client.create({ data: { name: "Sem perfil" } })).id, consultantId: u.b.id, createdById: u.b.id } });

    let centro = [item("1001", "Casa", "2", 2000, 2300, "Centro")];
    const igara = () => [item("3001", "Apartamento", "2", 1500, 1800, "Igara"), item("3002", "Apartamento", "1", 1600, 1900, "Igara")];
    const site = fakeSite((url) => (url.includes("+centro") ? centro : url.includes("+igara") ? igara() : []));
    const sent: { uid: string; title: string; body: string; url: string }[] = [];
    const notify = async (uid: string, p: { title: string; body: string; url: string }) => void sent.push({ uid, ...p });

    // antes das 8h não roda
    expect(await watchDemandOnSite(new Date("2026-10-28T09:00:00Z"), { fetchImpl: site, origin: ORIGIN, notify })).toEqual({ radar: 0, searches: 0 });
    expect(await watchDemandOnSite(NOW, { fetchImpl: site, origin: ORIGIN, notify })).toEqual({ radar: 0, searches: 0 });
    expect(sent).toEqual([]);
    expect(await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ siteSeenCodes: ["1001"], siteNewCodes: [] });
    // a busca não sugere o imóvel que o cliente já visitou (3001)
    expect(await db.clientSearch.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ siteSeenCodes: ["3002"] });
    // mesmo dia: não confere de novo
    centro = [...centro, item("1002", "Casa", "3", 2200, 2400, "Centro")];
    await watchDemandOnSite(new Date(NOW.getTime() + 3600_000), { fetchImpl: site, origin: ORIGIN, notify });
    expect(sent).toEqual([]);
    // dia seguinte: 1002 é novo
    clearSiteCache();
    const next = new Date(NOW.getTime() + DAY);
    expect(await watchDemandOnSite(next, { fetchImpl: site, origin: ORIGIN, notify })).toEqual({ radar: 1, searches: 0 });
    expect(await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ siteNewCodes: ["1002"] });
    expect(sent.map((x) => [x.uid, x.title, x.url])).toEqual([[jasmin.id, "Imóvel novo no site para o radar", "/radar?aba=novos"]]);
    expect(JSON.stringify(sent)).not.toContain("Rita");
    expect(await db.radarEvent.count({ where: { radarId: r.id, note: "Novo no site com o perfil: 1002" } })).toBe(1);

    // opções enviadas ao cliente: viram imóveis do pedido e saem dos novos
    await radarOptionsSent(jasmin, r.id, ["1002"], "whatsapp", next);
    expect(await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ foundCodes: ["1002"], siteNewCodes: [], status: "FOUND" });
    await expect(searchOptionsSent(u.b, s.id, ["3002"], "whatsapp", next)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await searchOptionsSent(u.a, s.id, ["3002"], "whatsapp", next);
    const after = await db.clientSearch.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.sentCodes).toEqual(["3002"]);
    expect(after.note).toContain("opções enviadas pelo WhatsApp: 3002");
  });

  it("anúncio do imóvel saiu do site antes da visita: avisa consultora e pré-atendimento uma vez; código que nunca esteve no site não alarma", async () => {
    await db.property.createMany({ data: [{ code: "664465", title: "Apartamento no Centro", pageStatus: "OK", pageCheckedAt: new Date(NOW.getTime() - 2 * DAY) }, { code: "777777" }] });
    const tomorrow = new Date(NOW.getTime() + DAY);
    const v = await db.visit.create({ data: { origin: "MANUAL", assignmentStatus: "MANUAL", clientName: "Lindomar", propertyCode: "664465", consultantId: u.a.id, scheduledStart: tomorrow, scheduledEnd: new Date(tomorrow.getTime() + 3600_000) } });
    await db.visit.create({ data: { origin: "MANUAL", assignmentStatus: "MANUAL", clientName: "Outro", propertyCode: "777777", consultantId: u.a.id, scheduledStart: tomorrow, scheduledEnd: new Date(tomorrow.getTime() + 3600_000) } });
    const sent: { uid: string; url: string }[] = [];
    const notify = async (uid: string, p: { url: string }) => void sent.push({ uid, url: p.url });
    const site = fakeSite(() => 404);
    expect(await checkVisitListings(NOW, { fetchImpl: site, notify })).toEqual({ gone: 1 });
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).listingGoneAt).toEqual(NOW);
    expect(sent).toEqual([{ uid: u.a.id, url: `/visitas/${v.id}` }, { uid: jasmin.id, url: `/agenda-do-dia/${v.id}/opcoes` }]);
    expect(await checkVisitListings(new Date(NOW.getTime() + 60_000), { fetchImpl: site, notify })).toEqual({ gone: 0 });
    expect(sent.length).toBe(2);
  });

  it("peças: novo × visto, tipo pela categoria e mensagem de opções", () => {
    expect(diffSeen({ siteSeenCodes: [], siteCheckedAt: null }, ["1", "2"])).toEqual({ newOnes: [], seen: ["1", "2"] });
    expect(diffSeen({ siteSeenCodes: ["1"], siteCheckedAt: NOW }, ["1", "3"])).toEqual({ newOnes: ["3"], seen: ["1", "3"] });
    expect(profileTypeOf("Casa em Condomínio")).toBe("Casa");
    expect(profileTypeOf("Kitnet/JK")).toBe("Kitnet / studio");
    expect(profileTypeOf("Galpão / Pavilhão")).toBeNull();
    const m = optionsMessage("Rita Souza", "Jasmin Becker", [{ code: "1002", category: "Casa", neighborhood: "Centro", bedrooms: 3, totalCents: 240000, rentCents: 220000, url: `${ORIGIN}/imovel/aluguel/1002` }]);
    expect(m).toContain("Oi, Rita! Aqui é a Jasmin, da Auxiliadora Predial. Separei uma opção");
    expect(m).toContain("1) Casa · Centro · 3 quartos · R$ 2.400 no total\nhttps://www.auxiliadorapredial.com.br/imovel/aluguel/1002");
  });
});

describe("mapa da demanda", () => {
  it("soma radar e clientes em busca por bairro, tipo, quartos e valor; cruza com a oferta no site e monta o resumo da captação", async () => {
    const base = { phone: "(51) 99876-1111", wants: "procura casa" };
    await createRadar(jasmin, { ...base, clientName: "Ana", areas: "Centro", propertyType: "Casa", bedrooms: "2", maxBudget: "2.500" }, NOW);
    await createRadar(jasmin, { ...base, clientName: "Bia", areas: "centro, Igara", propertyType: "Casa", bedrooms: "2", maxBudget: "2.000" }, NOW);
    const c = await db.client.create({ data: { name: "C" } });
    await db.clientSearch.create({ data: { clientId: c.id, consultantId: u.a.id, createdById: u.a.id, areas: ["Igara"], propertyType: "Apartamento", bedrooms: 1, maxBudgetCents: 150000 } });
    // só a captação e a gestão: consultora e pré-atendimento não acessam
    await expect(demandMap(u.a, { days: 90 }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(demandMap(jasmin, { days: 90 }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const cap = await db.user.create({ data: { name: "Carla Captadora", email: "captacao@exemplo.test", role: "CAPTURE" } });
    const captador = { id: cap.id, role: "CAPTURE" as const };
    const d = await demandMap(captador, { days: 90 }, NOW);
    expect(d).toMatchObject({ total: 3, radar: 2, searches: 1, open: 3 });
    expect(d.byArea).toEqual([{ label: "Centro", count: 2 }, { label: "Igara", count: 2 }]);
    expect(d.byBedrooms.find((b) => b.label === "2 quartos")?.count).toBe(2);
    expect(d.byBudget.map((b) => b.count)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(d.segments[0]).toMatchObject({ area: "Centro", type: "Casa", demand: 2, bedrooms: 2, budgetCents: 200000 });

    const urls: string[] = [];
    const site = (async (url: string) => {
      urls.push(url);
      return new Response(page([], url.includes("+centro") ? 0 : url.includes("tipoImovel=apartamento") ? 7 : 1), { status: 200 });
    }) as unknown as typeof fetch;
    const rows = await segmentSupply(captador, d.segments, { fetchImpl: site, origin: ORIGIN });
    expect(urls).toContain(`${ORIGIN}/alugar/residencial/rs+canoas+centro?tipoImovel=casa&quartos=2&valorMax=2000`);
    expect(rows.map((r) => [r.area, r.type, r.supply, r.gap])).toEqual([
      ["Centro", "Casa", 0, "none"],
      ["Igara", "Apartamento", 7, "ok"],
      ["Igara", "Casa", 1, "ok"],
    ]);
    const brief = captureBrief(90, rows)!;
    expect(brief).toContain("• Casa · Centro · 2+ quartos · até R$ 2.000 — 2 clientes procurando, nenhum no site");
    expect(brief).not.toContain("Apartamento");
    expect(brief).not.toContain("99876");
  });
});

describe("captação", () => {
  it("vê os pedidos passados à captação sem nome nem telefone; 'Achei imóvel' avisa o pré-atendimento e põe o pedido para cobrar hoje", async () => {
    const { captureFound, notifyCaptureNewRequest } = await import("@/server/radar");
    const { captureRequests, countCaptureOpen } = await import("@/server/demand");
    const cap = await db.user.create({ data: { name: "Carla Captadora", email: "captacao@exemplo.test", role: "CAPTURE" } });
    const captador = { id: cap.id, role: "CAPTURE" as const };
    const r = await createRadar(jasmin, { clientName: "Rita Secreta", phone: "(51) 99876-1111", wants: "Casa com pátio para cachorro", areas: "Centro", propertyType: "Casa", bedrooms: "2", maxBudget: "2.500" }, NOW);
    await createRadar(jasmin, { clientName: "Ainda não passou", phone: "(51) 99876-2222", wants: "Apartamento perto da estação", sentToCapture: false }, NOW);

    const sentCap: { uid: string; body: string }[] = [];
    await notifyCaptureNewRequest(r.id, async (uid, p) => void sentCap.push({ uid, body: p.body }));
    expect(sentCap).toEqual([{ uid: cap.id, body: "Casa · 2+ quartos · Centro · até R$\u00a02.500" }]);

    await expect(captureRequests(jasmin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const list = await captureRequests(captador, NOW);
    expect(list.map((x) => x.id)).toEqual([r.id]); // o que não foi passado à captação não aparece
    expect(JSON.stringify(list)).not.toContain("Rita");
    expect(JSON.stringify(list)).not.toContain("99876");
    expect(await countCaptureOpen(captador)).toBe(1);

    await expect(captureFound(u.a, r.id, { codes: "734999" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(captureFound(captador, r.id, { codes: "" }, NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    const sentPre: { uid: string; url: string }[] = [];
    await captureFound(captador, r.id, { codes: "734999", note: "entra no site amanhã" }, new Date(NOW.getTime() + DAY), async (uid, p) => void sentPre.push({ uid, url: p.url }));
    expect(sentPre).toEqual([{ uid: jasmin.id, url: `/radar/${r.id}` }]);
    const after = await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } });
    expect(after).toMatchObject({ status: "FOUND", foundCodes: ["734999"] });
    expect(after.followUpOn.toISOString().slice(0, 10)).toBe("2026-10-29");
    expect(await db.radarEvent.count({ where: { radarId: r.id, note: "Captação achou: 734999. — entra no site amanhã", authorId: cap.id } })).toBe(1);
    expect(await countCaptureOpen(captador)).toBe(0);
  });
});

describe("demonstração pública da captação", () => {
  it("monta o mapa e os pedidos só com dados fictícios do código; sugestões têm limite e só a gestão lê", async () => {
    const { demoDemand, demoRequests, submitDemoFeedback, listDemoFeedback } = await import("@/server/demo-capture");
    // nada do banco entra na demonstração
    await createRadar(jasmin, { clientName: "Cliente Real", phone: "(51) 99876-1111", wants: "Pedido real que não pode aparecer", areas: "Niterói", propertyType: "Casa", bedrooms: "2", maxBudget: "2.500" }, NOW);
    const d = demoDemand(90, NOW);
    expect(d.total).toBeGreaterThan(10);
    expect(d.byArea.map((a) => a.label)).not.toContain("Niterói");
    const reqs = demoRequests(NOW);
    expect(JSON.stringify(reqs)).not.toContain("Pedido real");
    expect(reqs.some((r) => r.status === "FOUND")).toBe(true);

    await expect(submitDemoFeedback({ demo: "captacao", text: "oi", ip: "1.2.3.4" })).rejects.toMatchObject({ code: "VALIDATION" });
    await submitDemoFeedback({ demo: "captacao", name: "Gerente Captação", text: "Queria filtrar pedidos por bairro", ip: "1.2.3.4" });
    for (let i = 0; i < 9; i++) await submitDemoFeedback({ demo: "captacao", text: `sugestão número ${i}`, ip: "1.2.3.4" });
    await expect(submitDemoFeedback({ demo: "captacao", text: "mais uma sugestão", ip: "1.2.3.4" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(listDemoFeedback(jasmin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const fb = await listDemoFeedback(u.manager);
    expect(fb.length).toBe(10);
    expect(fb.some((f) => f.name === "Gerente Captação" && f.text === "Queria filtrar pedidos por bairro")).toBe(true);
  });
});
