// "Antes de entrar": ficha da visita — comparações, histórico no escopo de quem vê e números do imóvel.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { concludeVisit, createManualVisit } from "@/server/visits";
import { compareWithRejected, visitBrief } from "@/server/brief";
import { toLocalInput } from "@/lib/time";
import { makeUsers, reason, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
const NOW = new Date("2026-10-09T17:00:00Z");
let seq = 0;
const at = (days: number, consultantId: string, code: string, phone = "(51) 99876-1111", name = "Cliente Ficha") =>
  createManualVisit(u.admin, { requestId: `brief-${++seq}-req`, scheduledStart: toLocalInput(new Date(NOW.getTime() + days * 86400_000)), clientName: name, phoneRaw: phone, propertyCode: code, consultantId });

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

const sp = (t: string | null) => t?.replace(/\u00a0/g, " ") ?? null;

describe("comparação com imóvel recusado", () => {
  const p = (code: string, o: Partial<{ neighborhood: string; rent: number; totalPrice: number; area: number; bedrooms: number }> = {}) => ({ code, neighborhood: null, rent: null, totalPrice: null, area: null, bedrooms: null, ...o });
  it("preço, tamanho, bairro e mesmo imóvel", () => {
    expect(sp(compareWithRejected(p("2", { totalPrice: 1900 }), p("1", { totalPrice: 2300 }), "Preço/custo total"))).toBe("Achou caro o 1 (R$ 2.300). Este sai R$ 400 mais barato (R$ 1.900).");
    expect(sp(compareWithRejected(p("2", { totalPrice: 2600 }), p("1", { totalPrice: 2300 }), "Preço/custo total"))).toMatch(/R\$ 300 mais caro/);
    expect(compareWithRejected(p("2", { area: 80 }), p("1", { area: 64 }), "Tamanho/distribuição")).toBe("Achou o 1 pequeno (64 m²). Este tem 80 m² (+16 m²).");
    expect(compareWithRejected(p("2", { neighborhood: "Centro" }), p("1", { neighborhood: "Igara" }), "Localização")).toBe("Não gostou da localização do 1 (Igara). Este fica em Centro.");
    expect(compareWithRejected(p("1"), p("1"), "Conservação")).toMatch(/mesmo imóvel/);
    expect(compareWithRejected(p("2"), p("1"), "Escolheu outro imóvel")).toBe("Recusou o 1: “Escolheu outro imóvel”.");
  });
});

describe("ficha da visita", () => {
  it("mostra histórico só no escopo da consultora, pontos para a conversa e números do imóvel", async () => {
    const preco = await reason("Preço/custo total");
    await db.property.create({ data: { code: "100", totalPrice: 2300, neighborhood: "Igara" } });
    await db.property.create({ data: { code: "200", totalPrice: 1900, neighborhood: "Centro", photos: ["https://img.test/1.jpg"] } });
    // visita anterior do mesmo cliente com a consultora A: recusou por preço
    const prev = await at(-5, u.a.id, "100");
    await concludeVisit(u.admin, prev.id, { requestId: "brief-prev-done", expectedVersion: 1, status: "DONE", evaluation: "NEGATIVE", negativeReasonId: preco.id, note: "Achou caro, quer até 2 mil." }, NOW);
    // outra visita do mesmo cliente com a consultora B (não deve aparecer para A)
    const other = await at(-3, u.b.id, "300");
    await concludeVisit(u.admin, other.id, { requestId: "brief-other-done", expectedVersion: 1, status: "DONE", evaluation: "UNDECIDED", note: "Observação da consultora B" }, NOW);
    // outro visitante do imóvel 200 recusou por preço (só números aparecem)
    for (const [i, phone] of ["(51) 99876-2222", "(51) 99876-3333"].entries()) {
      const v = await at(-2 - i, u.b.id, "200", phone, `Outra Pessoa ${i}`);
      await concludeVisit(u.admin, v.id, { requestId: `brief-team-${i}`, expectedVersion: 1, status: "DONE", evaluation: "NEGATIVE", negativeReasonId: preco.id, note: "Nota privada de outra pessoa" }, NOW);
    }
    const today = await at(0.1, u.a.id, "200");

    const b = await visitBrief(u.a, today.id);
    expect(b.history.map((h) => h.propertyCode)).toEqual(["100"]);
    expect(b.property).toMatchObject({ code: "200", totalPrice: 1900, photos: ["https://img.test/1.jpg"] });
    const texts = b.points.map((p) => sp(p.text)!);
    expect(texts).toContain("Achou caro o 100 (R$ 2.300). Este sai R$ 400 mais barato (R$ 1.900).");
    expect(texts.some((t) => t.includes("Outros visitantes citaram “Preço/custo total” (2 de 2"))).toBe(true);
    expect(b.stats).toMatchObject({ done: 2, negative: 2 });
    expect(JSON.stringify(b)).not.toMatch(/Outra Pessoa|Nota privada|Observação da consultora B/);

    // gestão vê o histórico completo; outra consultora não abre a ficha
    expect((await visitBrief(u.manager, today.id)).history.map((h) => h.propertyCode)).toEqual(["300", "100"]);
    await expect(visitBrief(u.b, today.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
