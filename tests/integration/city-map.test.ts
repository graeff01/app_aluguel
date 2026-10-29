// Mapa de Canoas: leitura diária dos imóveis do site, procura × oferta por bairro e o detalhe do bairro.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createRadar } from "@/server/radar";
import { crawlSiteInventory } from "@/server/site-inventory";
import { areaDetail, areaStatus, cityMap } from "@/server/city-map";
import { ensureAreaCoords } from "@/server/area-geo";
import { makeUsers, resetDb } from "../helpers/db";

const ORIGIN = "https://www.auxiliadorapredial.com.br";
const NOW = new Date("2026-10-28T13:00:00Z"); // 10h em Brasília
const DAY = 86400_000;
let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
let cap: { id: string; role: "CAPTURE" };

const item = (codigo: string, cat: string, dorm: string, valor: number, bairro: string) => ({ codigo, categoria: { nome: cat }, dormitorios: dorm, valores: { valor, valorTotal: valor + 300 }, endereco: { bairro: { nome: bairro } }, fotos: [] });
const page = (items: unknown[], total: number) => `<script>self.__next_f.push([1,${JSON.stringify(`1e:${JSON.stringify(["$", "$L1f", null, { initialData: items, totalItems: total }])}`)}])</script>`;
/** Site falso: residencial com 2 páginas (3 imóveis), comercial com 1. */
const site = (res: unknown[][], com: unknown[]) =>
  (async (url: string) => {
    if (url.includes("/comercial/")) return new Response(page(url.includes("page=") ? [] : com, com.length), { status: 200 });
    const n = Number(new URL(url).searchParams.get("page") ?? "1");
    const total = res.flat().length;
    return new Response(page(res[n - 1] ?? [], total), { status: 200 });
  }) as unknown as typeof fetch;
const geo = (async (url: string) => {
  const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
  const pts: Record<string, [string, string]> = { Centro: ["-29.916", "-51.185"], Igara: ["-29.898", "-51.157"], Niterói: ["-29.951", "-51.165"] };
  const hit = Object.entries(pts).find(([k]) => q.startsWith(k));
  return new Response(JSON.stringify(hit ? [{ lat: hit[1][0], lon: hit[1][1] }] : []), { status: 200 });
}) as unknown as typeof fetch;

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  jasmin = { id: (await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } })).id, role: "PRE_SERVICE" };
  cap = { id: (await db.user.create({ data: { name: "Danusa Oliveira", email: "danusa@exemplo.test", role: "CAPTURE" } })).id, role: "CAPTURE" };
});

describe("imóveis do site (leitura diária)", () => {
  it("lê todas as páginas, guarda por bairro, marca o que saiu e só roda uma vez por dia a partir das 6h", async () => {
    const day1 = site([[item("1001", "Casa", "2", 2000, "Centro"), item("1002", "Apartamento", "2", 1500, "Centro")], [item("1003", "Apartamento", "1", 1200, "Igara")]], [item("2001", "Loja / Salão", "0", 5000, "Centro")]);
    expect(await crawlSiteInventory(new Date("2026-10-28T08:00:00Z"), { fetchImpl: day1, origin: ORIGIN })).toBeNull(); // 5h
    const r = await crawlSiteInventory(NOW, { fetchImpl: day1, origin: ORIGIN });
    expect(r).toEqual({ residencial: { seen: 3, total: 3, gone: 0 }, comercial: { seen: 1, total: 1, gone: 0 } });
    expect(await db.siteInventory.findUniqueOrThrow({ where: { code: "1003" } })).toMatchObject({ areaKey: "igara", kind: "residencial", rentCents: 120000 });
    expect(await crawlSiteInventory(new Date(NOW.getTime() + 3600_000), { fetchImpl: day1, origin: ORIGIN })).toBeNull(); // mesmo dia

    // dia seguinte: 1002 saiu (alugado), 1004 entrou
    const day2 = site([[item("1001", "Casa", "2", 2000, "Centro"), item("1004", "Casa", "3", 2600, "Niterói")], [item("1003", "Apartamento", "1", 1200, "Igara")]], [item("2001", "Loja / Salão", "0", 5000, "Centro")]);
    const r2 = await crawlSiteInventory(new Date(NOW.getTime() + DAY), { fetchImpl: day2, origin: ORIGIN });
    expect(r2?.residencial).toEqual({ seen: 3, total: 3, gone: 1 });
    expect((await db.siteInventory.findUniqueOrThrow({ where: { code: "1002" } })).goneAt).not.toBeNull();

    // site fora do ar: não marca nada como saído
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await crawlSiteInventory(new Date(NOW.getTime() + 2 * DAY), { fetchImpl: down, origin: ORIGIN, force: true });
    expect(await db.siteInventory.count({ where: { goneAt: null } })).toBe(4);
  });
});

describe("mapa de Canoas", () => {
  it("cruza procura e imóveis por bairro; o detalhe traz a procura e os imóveis do bairro, sem dados de cliente", async () => {
    expect([areaStatus(0, 5), areaStatus(3, 0), areaStatus(3, 4), areaStatus(3, 6)]).toEqual(["idle", "none", "low", "ok"]);
    await crawlSiteInventory(NOW, { fetchImpl: site([[item("1001", "Casa", "2", 2000, "Centro"), item("1002", "Apartamento", "2", 1500, "Centro")], [item("1003", "Apartamento", "1", 1200, "Igara")]], []), origin: ORIGIN });
    const r = await createRadar(jasmin, { clientName: "Rita Secreta", phone: "(51) 99876-1111", wants: "Casa com pátio", areas: "Centro, Niterói", propertyType: "Casa", bedrooms: "2", maxBudget: "2.500" }, NOW);
    await createRadar(jasmin, { clientName: "Ana", phone: "(51) 99876-2222", wants: "Casa perto do trem", areas: "Niterói", propertyType: "Casa", maxBudget: "2.000" }, NOW);

    await expect(cityMap(u.a)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const m = await cityMap(cap, { geocode: 5, fetchImpl: geo, now: NOW });
    expect(m.areas.map((a) => [a.name, a.demand, a.res, a.status])).toEqual([
      ["Niterói", 2, 0, "none"],
      ["Centro", 1, 2, "ok"],
      ["Igara", 0, 1, "idle"],
    ]);
    expect(m.totals).toEqual({ demand: 2, res: 3, com: 0 });
    expect(JSON.stringify(m)).not.toContain("Rita");
    await ensureAreaCoords(["Centro"], { fetchImpl: (async () => { throw new Error("não deveria consultar"); }) as unknown as typeof fetch, now: NOW }); // cache

    const d = await areaDetail(cap, "Centro");
    expect(d).toMatchObject({ demand: 1, types: [{ label: "Casa", n: 1 }], bedrooms: 2, budgetCents: 250000 });
    expect(d.listings.map((l) => l.code)).toEqual(["1001", "1002"]); // a casa (o que procuram ali) vem antes
    expect(d.pedidos.map((p) => p.id)).toEqual([r.id]);
    expect(JSON.stringify(d)).not.toContain("Rita");
  });
});
