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

describe("sugestões da demonstração (encerrada)", () => {
  it("as que chegaram continuam guardadas e só a gestão lê", async () => {
    const { listDemoFeedback } = await import("@/server/demo-capture");
    await db.demoFeedback.create({ data: { demo: "captacao", name: "Gerente Captação", text: "Queria filtrar pedidos por bairro" } });
    await expect(listDemoFeedback(jasmin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listDemoFeedback(u.manager)).map((f) => f.text)).toEqual(["Queria filtrar pedidos por bairro"]);
  });
});

describe("fora do perfil", () => {
  it("a opção recusada sai das sugestões e o motivo ajusta as próximas (valor, bairro, garagem); dá para desfazer", async () => {
    const { similarOnSite, rejectRadarSuggestion, resetRadarRules } = await import("@/server/radar");
    const { learnFromRejection, describeRules } = await import("@/server/site-search");
    expect(learnFromRejection(null, "PRICE", { code: "1", category: null, neighborhood: null, bedrooms: null, priceCents: 156800 })).toEqual({ rules: { priceCapCents: 156700 }, learned: "só até R$\u00a01.567" });
    expect(learnFromRejection({ minBedrooms: 2 }, "SMALL", { code: "1", category: null, neighborhood: null, bedrooms: 2, priceCents: null }).rules.minBedrooms).toBe(3);
    expect(learnFromRejection(null, "OFFERED", { code: "1", category: null, neighborhood: null, bedrooms: null, priceCents: null }).learned).toBeNull();

    const withParking = (codigo: string, cat: string, dorm: string, total: number, bairro: string, vagas: string) => ({ ...item(codigo, cat, dorm, total, total, bairro), vagas });
    const list = [
      withParking("844975", "Apartamento", "2", 1568, "Nossa Senhora das Graças", "1"),
      withParking("700001", "Apartamento", "2", 1400, "Centro", "0"),
      withParking("700002", "Apartamento", "2", 1450, "Centro", "1"),
      withParking("700003", "Apartamento", "2", 1300, "Fátima", "1"),
    ];
    const site = fakeSite(() => list);
    const r = await createRadar(jasmin, { clientName: "Cliente Teste", phone: "(51) 99876-1111", wants: "apto 2 quartos", propertyType: "Apartamento", bedrooms: "2", maxBudget: "1.500" }, NOW);
    const load = async () => db.clientRadar.findUniqueOrThrow({ where: { id: r.id } });
    const codes = async () => (await similarOnSite(jasmin, await load(), { fetchImpl: site, origin: ORIGIN })).items.map((i) => i.code);
    expect(await codes()).toEqual(["700003", "700001", "700002", "844975"]);

    await expect(rejectRadarSuggestion(jasmin, r.id, { reason: "OTHER", listing: { code: "700003", category: "Apartamento", neighborhood: "Fátima", bedrooms: 2, priceCents: 130000 } })).rejects.toMatchObject({ code: "VALIDATION" });
    // valor: 844975 (R$ 1.568) era "um pouco acima"; com o teto, saem ele e os acima de R$ 1.567
    const a = await rejectRadarSuggestion(jasmin, r.id, { reason: "PRICE", listing: { code: "844975", category: "Apartamento", neighborhood: "Nossa Senhora das Graças", bedrooms: 2, priceCents: 156800 } });
    expect(a.learned).toBe("só até R$\u00a01.567");
    expect(await codes()).toEqual(["700003", "700001", "700002"]);
    // bairro e garagem
    await rejectRadarSuggestion(jasmin, r.id, { reason: "AREA", listing: { code: "700003", category: "Apartamento", neighborhood: "Fátima", bedrooms: 2, priceCents: 130000 } });
    await rejectRadarSuggestion(jasmin, r.id, { reason: "GARAGE", listing: { code: "700001", category: "Apartamento", neighborhood: "Centro", bedrooms: 2, priceCents: 140000 } });
    expect(await codes()).toEqual(["700002"]);
    const saved = await load();
    expect(saved.rejectedCodes).toEqual(["844975", "700003", "700001"]);
    expect(describeRules(saved.siteRules as never)).toEqual(["até R$\u00a01.567", "com garagem", "sem Fátima"]);
    expect(await db.radarEvent.count({ where: { radarId: r.id, note: { startsWith: "Fora do perfil: imóvel 844975" } } })).toBe(1);
    // desfazer ajustes: as regras saem, as recusadas continuam fora
    await resetRadarRules(jasmin, r.id);
    expect(await codes()).toEqual(["700002"]);
  });
});

describe("leitura de mercado da captação", () => {
  it("parecer no pedido: só captação/gestão; avisa o pré-atendimento sem dados do cliente e fica no histórico", async () => {
    const { setRadarMarketNote } = await import("@/server/market");
    const cap = await db.user.create({ data: { name: "Carla Captadora", email: "captacao@exemplo.test", role: "CAPTURE" } });
    const captador = { id: cap.id, role: "CAPTURE" as const };
    const r = await createRadar(jasmin, { clientName: "Rita Secreta", phone: "(51) 99876-1111", wants: "Casa com pátio", areas: "Centro", propertyType: "Casa", bedrooms: "2", maxBudget: "2.500" }, NOW);
    const sent: { uid: string; body: string; url: string }[] = [];
    const notify = async (uid: string, p: { body: string; url: string }) => void sent.push({ uid, body: p.body, url: p.url });

    await expect(setRadarMarketNote(jasmin, r.id, { tag: "ABOVE" }, NOW, notify)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setRadarMarketNote(captador, r.id, { tag: "XYZ" }, NOW, notify)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setRadarMarketNote(captador, r.id, { tag: "ABOVE", realistic: "abc" }, NOW, notify)).rejects.toMatchObject({ code: "VALIDATION" });
    await setRadarMarketNote(captador, r.id, { tag: "ABOVE", realistic: "2.800", text: "Com pátio costuma passar disso." }, NOW, notify);

    expect(await db.clientRadar.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ marketTag: "ABOVE", marketCents: 280000, marketNote: "Com pátio costuma passar disso.", marketNoteById: cap.id });
    expect(sent).toEqual([{ uid: jasmin.id, body: "Tem, mas acima desse valor. Toque para ver e conversar com o cliente.", url: `/radar/${r.id}` }]);
    expect(JSON.stringify(sent)).not.toContain("Rita");
    const ev = await db.radarEvent.findFirstOrThrow({ where: { radarId: r.id, note: { startsWith: "Parecer da captação" } } });
    expect(ev.note).toBe("Parecer da captação: Tem, mas acima desse valor — valor realista: R$ 2.800 — Com pátio costuma passar disso.");
  });

  it("leitura por perfil: grava/atualiza por bairro + tipo, vale para os pedidos com esse perfil e entra no resumo", async () => {
    const { listMarketNotes, noteForSegment, notesForProfile, upsertMarketNote } = await import("@/server/market");
    const cap = await db.user.create({ data: { name: "Carla Captadora", email: "captacao@exemplo.test", role: "CAPTURE" } });
    const captador = { id: cap.id, role: "CAPTURE" as const };
    await expect(upsertMarketNote(u.a, { tag: "HARD", area: "Centro", type: "Casa" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await upsertMarketNote(captador, { tag: "HARD", area: "Centro", type: "Casa" });
    await upsertMarketNote(captador, { tag: "FEWER_ROOMS", text: "Até 2.300 só 1 quarto.", area: " centro ", type: "Casa" }); // mesmo perfil: atualiza
    await upsertMarketNote(captador, { tag: "NEARBY", area: "São José", type: null });

    const notes = await listMarketNotes();
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.areaKey === "centro")).toMatchObject({ tag: "FEWER_ROOMS", author: "Carla Captadora" });
    expect(notesForProfile(notes, { areas: ["Centro"], propertyType: "Apartamento" })).toEqual([]);
    expect(notesForProfile(notes, { areas: ["Sao Jose", "Centro"], propertyType: "Casa" }).map((n) => n.tag).sort()).toEqual(["FEWER_ROOMS", "NEARBY"]);
    expect(noteForSegment(notes, "São José", "Kitnet / studio")?.tag).toBe("NEARBY");

    const brief = captureBrief(90, [{ area: "Centro", type: "Casa", bedrooms: 2, budgetCents: 230000, demand: 3, open: 3, supply: 0, gap: "none", url: "" }], notes)!;
    expect(brief).toContain("   → Captação: Nesse valor, só com menos quartos — Até 2.300 só 1 quarto.");
  });
});
