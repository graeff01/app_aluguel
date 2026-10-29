// "Quanto rende o seu imóvel?": estimativa e contato do proprietário.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createRadar } from "@/server/radar";
import { clearSiteCache } from "@/server/site-search";
import { createOwnerLead, listOwnerLeads, ownerEstimate, runOwnerLeadRetention, updateOwnerLead } from "@/server/owner-leads";
import { listAlerts } from "@/server/alerts";
import { makeUsers, resetDb } from "../helpers/db";

const ORIGIN = "https://www.auxiliadorapredial.com.br";
const NOW = new Date("2026-10-28T13:00:00Z");
const DAY = 86400_000;
let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
let cap: { id: string; role: "CAPTURE" };

const item = (codigo: string, cat: string, dorm: string, valor: number, total: number, bairro: string) => ({ codigo, categoria: { nome: cat }, dormitorios: dorm, valores: { valor, valorTotal: total }, endereco: { bairro: { nome: bairro } }, fotos: [] });
const page = (items: unknown[], total = items.length) => `<script>self.__next_f.push([1,${JSON.stringify(`1e:${JSON.stringify(["$", "$L1f", null, { initialData: items, totalItems: total }])}`)}])</script>`;

beforeEach(async () => {
  await resetDb();
  clearSiteCache();
  u = await makeUsers();
  jasmin = { id: (await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } })).id, role: "PRE_SERVICE" };
  cap = { id: (await db.user.create({ data: { name: "Danusa Oliveira", email: "danusa@exemplo.test", role: "CAPTURE" } })).id, role: "CAPTURE" };
});

describe("quanto rende o seu imóvel", () => {
  it("estima pelo site (no bairro; com poucos, na cidade) e conta os clientes que procuram, sem dados deles", async () => {
    await createRadar(jasmin, { clientName: "Rita Secreta", phone: "(51) 99876-1111", wants: "Casa com pátio", areas: "Centro", propertyType: "Casa", bedrooms: "2", maxBudget: "2.500" }, NOW);
    await createRadar(jasmin, { clientName: "Ana", phone: "(51) 99876-2222", wants: "Casa grande", areas: "Centro", propertyType: "Casa", bedrooms: "3", maxBudget: "3.500" }, NOW);
    const c = await db.client.create({ data: { name: "Bruno" } });
    await db.clientSearch.create({ data: { clientId: c.id, consultantId: u.a.id, createdById: u.a.id, areas: ["centro"], maxBudgetCents: 230000 } });
    const site = (async (url: string) =>
      new Response(page(url.includes("+centro") ? [item("1001", "Casa", "2", 2000, 2300, "Centro"), item("1002", "Casa", "2", 2400, 2700, "Centro"), item("1003", "Casa", "3", 3000, 3300, "Centro")] : []), { status: 200 })) as unknown as typeof fetch;

    const e = await ownerEstimate({ area: "Centro", propertyType: "Casa", bedrooms: "2" }, "1.1.1.1", { fetchImpl: site, origin: ORIGIN });
    expect(e.sample).toBe(2); // só os de 2 quartos
    expect(e.scope).toBe("area"); // menos de 3 no bairro: tenta a cidade (vazia aqui) e fica com o bairro
    expect(e.range).toEqual({ low: 210000, mid: 220000, high: 230000 });
    expect(e.demand).toBe(2); // Rita (2+) e a busca sem quartos; Ana quer 3+
    expect(e.demandBudgetCents).toBe(240000); // mediana de R$ 2.500 e R$ 2.300
    expect(JSON.stringify(e)).not.toContain("Rita");
    await expect(ownerEstimate({ area: "", propertyType: "Casa" }, "1.1.1.1", { fetchImpl: site, origin: ORIGIN })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("ignora valores fora da realidade (anúncio com erro ou de venda)", async () => {
    const { saneRents } = await import("@/server/owner-leads");
    expect(saneRents([255000, 310800, 20000000])).toEqual([255000, 310800]);
    expect(saneRents([200000, 220000, 230000, 250000, 900000, 50000])).toEqual([200000, 220000, 230000, 250000]);
  });

  it("contato do proprietário: exige autorização, avisa a captação, não duplica e segue o atendimento até a retenção LGPD", async () => {
    const base = { area: "Centro.", propertyType: "Casa", bedrooms: 2, name: "Seu Pedro", phone: "(51) 99999-1234", wanted: "2.800", message: "Desocupa em dezembro", estimateCents: 220000, demand: 3 };
    await expect(createOwnerLead({ ...base, consent: false }, "2.2.2.2", NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createOwnerLead({ ...base, phone: "123", consent: true }, "2.2.2.2", NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    const sent: string[] = [];
    const lead = await createOwnerLead({ ...base, consent: true }, "2.2.2.2", NOW, async (uid) => void sent.push(uid));
    expect(lead).toMatchObject({ area: "Centro", wantedCents: 280000, status: "NEW", demand: 3 });
    expect(lead.phoneEnc).not.toContain("99999");
    expect(sent).toEqual([cap.id]);
    expect((await listAlerts(cap)).map((a) => a.url)).toEqual(["/demanda/proprietarios"]);
    // mesmo WhatsApp em aberto: atualiza
    await createOwnerLead({ ...base, wanted: "3.000", consent: true }, "2.2.2.3", NOW, async () => undefined);
    expect(await db.ownerLead.count()).toBe(1);

    await expect(listOwnerLeads(jasmin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [row] = await listOwnerLeads(cap, NOW);
    expect(row).toMatchObject({ name: "Seu Pedro", phone: "+5551999991234", wantedCents: 300000 });
    await updateOwnerLead(cap, lead.id, { status: "CONTACTED" }, NOW);
    expect(await db.ownerLead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: "CONTACTED", handlerId: cap.id });
    await updateOwnerLead(cap, lead.id, { status: "LOST", note: "quer vender" }, NOW);
    await runOwnerLeadRetention(new Date(NOW.getTime() + 200 * DAY));
    expect(await db.ownerLead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ name: "Proprietário (dados apagados)", phoneEnc: null });
  });
});
