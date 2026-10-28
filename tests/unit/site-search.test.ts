import { describe, expect, it } from "vitest";
import { parseSearchPage, siteSearchUrl, slugify } from "@/server/site-search";

const ORIGIN = "https://www.auxiliadorapredial.com.br";
const item = (codigo: string, cat: string, dorm: string, valor: number, total: number, bairro: string) => ({
  codigo,
  link: `${ORIGIN}/imovel/aluguel/${codigo}/x`,
  categoria: { nome: cat, slug: slugify(cat) },
  dormitorios: dorm,
  valores: { valor, valorTotal: total },
  endereco: { cidade: { nome: "Canoas" }, bairro: { nome: bairro } },
  fotos: [`https://gestor.auxiliadorapredial.com.br/rest/image/${codigo}.jpg`],
});
/** Página no formato do site: o payload do Next.js vai em self.__next_f.push([1, "<texto>"]). */
const page = (items: unknown[], total = items.length) => {
  const payload = `1e:${JSON.stringify(["$", "$L1f", null, { initialData: items, initialParams: { page: 1 }, totalItems: total, totalPages: 1 }])}\n`;
  return `<html><script>self.__next_f.push([1,"0:{}"])</script><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></html>`;
};

describe("busca no site da imobiliária", () => {
  it("lê os imóveis do payload da página (código, tipo, quartos, valores em centavos, bairro, foto)", () => {
    const r = parseSearchPage(page([item("722136", "Apartamento", "2", 2500, 3148, "Centro"), { codigo: "<script>" }], 600), ORIGIN);
    expect(r.total).toBe(600);
    expect(r.items).toEqual([
      { code: "722136", category: "Apartamento", bedrooms: 2, rentCents: 250000, totalCents: 314800, neighborhood: "Centro", city: "Canoas", photoUrl: "https://gestor.auxiliadorapredial.com.br/rest/image/722136.jpg", url: `${ORIGIN}/imovel/aluguel/722136/x` },
    ]);
    expect(parseSearchPage("<html>mudou tudo</html>", ORIGIN)).toEqual({ items: [], total: null });
  });

  it("monta o endereço da busca com bairro, tipo, quartos e valor", () => {
    expect(siteSearchUrl(ORIGIN, { city: "rs+canoas", kind: "residencial", area: "Marechal Rondon", type: "casa", minBedrooms: 2, maxRentReais: 2500 })).toBe(`${ORIGIN}/alugar/residencial/rs+canoas+marechal-rondon?tipoImovel=casa&quartos=2&valorMax=2500`);
    expect(siteSearchUrl(ORIGIN, { city: "rs+canoas", kind: "comercial", page: 2 })).toBe(`${ORIGIN}/alugar/comercial/rs+canoas?page=2`);
  });
});
