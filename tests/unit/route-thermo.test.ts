import { describe, expect, it } from "vitest";
import { cleanAddress, mapsRouteUrl, routeQuery, wazeUrl } from "@/lib/address";
import { parseListing } from "@/server/property-preview";
import { classify, suggestionFor } from "@/server/thermometer";

describe("endereço e links de rota", () => {
  it("limpa o campo Local e descarta links de reunião", () => {
    expect(cleanAddress("  Rua  Exemplo, 100 -  Centro ")).toBe("Rua Exemplo, 100 - Centro");
    expect(cleanAddress("https://meet.google.com/abc-defg-hij")).toBeNull();
    expect(cleanAddress("123")).toBeNull();
    expect(cleanAddress(null)).toBeNull();
  });

  it("usa endereço completo; sem endereço, o bairro (aproximado)", () => {
    expect(routeQuery({ address: "Rua A, 10", neighborhood: "Centro", city: "Canoas" })).toEqual({ query: "Rua A, 10, Canoas - RS", approximate: false });
    expect(routeQuery({ address: "Rua A, 10, Canoas", neighborhood: null, city: "Canoas" })).toEqual({ query: "Rua A, 10, Canoas", approximate: false });
    expect(routeQuery({ address: null, neighborhood: "Igara", city: null })).toEqual({ query: "Igara, Canoas - RS", approximate: true });
    expect(routeQuery({ address: null, neighborhood: null, city: null })).toBeNull();
  });

  it("monta a rota do Maps com paradas intermediárias e destino final", () => {
    const url = new URL(mapsRouteUrl([{ query: "A, Canoas" }, { query: "B, Canoas" }, { query: "C, Canoas" }])!);
    expect(url.hostname).toBe("www.google.com");
    expect(url.searchParams.get("destination")).toBe("C, Canoas");
    expect(url.searchParams.get("waypoints")).toBe("A, Canoas|B, Canoas");
    expect(url.searchParams.has("origin")).toBe(false); // sai da localização atual
    expect(mapsRouteUrl([])).toBeNull();
    expect(new URL(mapsRouteUrl(Array.from({ length: 14 }, (_, i) => ({ query: `P${i}` })))!).searchParams.get("waypoints")!.split("|")).toHaveLength(9);
    expect(wazeUrl("Rua A, 10")).toContain("navigate=yes");
  });
});

describe("dados do anúncio", () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    offers: [
      {
        "@type": "Offer",
        price: 4500,
        itemOffered: { "@type": "Accommodation", name: "Apartamento - Nossa Senhora das Graças - Canoas", address: { streetAddress: "Rua da Agência 85" }, floorSize: { value: 91 }, numberOfRooms: 2, accommodationCategory: "Apartamento" },
        priceSpecification: [
          { name: "Aluguel", price: 4500 },
          { name: "Total", price: 5190 },
        ],
      },
    ],
  })}</script></head></html>`;
  it("lê tipo, bairro, cidade, valores, área e quartos (e ignora o endereço da agência)", () => {
    expect(parseListing(html, null)).toEqual({ category: "Apartamento", neighborhood: "Nossa Senhora das Graças", city: "Canoas", rent: 4500, totalPrice: 5190, area: 91, bedrooms: 2 });
  });
  it("sem JSON-LD, usa o bairro do título", () => {
    expect(parseListing("<html></html>", "Casa com 3 quartos para alugar em Igara, Canoas.")).toMatchObject({ neighborhood: "Igara", city: "Canoas", rent: null });
  });
});

describe("termômetro", () => {
  const c = (done: number, positive: number, negative = done - positive) => ({ done, positive, negative, undecided: 0, noShow: 0 });
  it("classifica com volume mínimo", () => {
    expect(classify(c(2, 0), null)).toBe("low_data");
    expect(classify(c(5, 0), null)).toBe("stuck");
    expect(classify(c(6, 1), null)).toBe("stuck");
    expect(classify(c(6, 2), null)).toBe("attention");
    expect(classify(c(6, 3), null)).toBe("healthy");
    expect(classify(c(6, 2, 4), { label: "Preço/custo total", count: 3 })).toBe("attention");
  });
  it("sugere ação pelo motivo mais citado", () => {
    expect(suggestionFor("Preço/custo total", "stuck")).toMatch(/valor/);
    expect(suggestionFor("Conservação", "attention")).toMatch(/manutenção/);
    expect(suggestionFor("Condições/garantia", "attention")).toMatch(/garantias/);
    expect(suggestionFor("Escolheu outro imóvel", "attention")).toContain("Escolheu outro imóvel");
    expect(suggestionFor(null, "healthy")).toMatch(/manter/);
    expect(suggestionFor("Preço/custo total", "low_data")).toMatch(/poucas visitas/);
  });
});
