// Desfazer, pré-visualização de imóvel (fetch SIMULADO) e respostas rápidas.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { concludeVisit, createManualVisit, undoConclusion } from "@/server/visits";
import { fetchPreview, propertyUrl, refreshPropertyPreviews } from "@/server/property-preview";
import { appendNote, quickNotesFor } from "@/lib/quick-notes";
import { removeDemoData } from "@/server/demo";
import { makeUsers, resetDb } from "../helpers/db";

const NOW = new Date("2026-10-06T18:00:00Z");
let u: Awaited<ReturnType<typeof makeUsers>>;
let seq = 0;
const visit = (consultantId: string, code = "761739") =>
  createManualVisit(u.admin, { requestId: `ext-${++seq}-req`, scheduledStart: "2026-10-06T10:00", clientName: "Cliente Sintético", phoneRaw: "", propertyCode: code, consultantId });

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

describe("desfazer o primeiro registro", () => {
  it("volta a visita para pendente e remove a oportunidade criada", async () => {
    const v = await visit(u.a.id);
    const at = new Date();
    await concludeVisit(u.a, v.id, { requestId: "undo-req-1", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "ok" }, at);
    expect(await db.opportunity.count()).toBe(1);
    const back = await undoConclusion(u.a, v.id, "undo-req-1", new Date(at.getTime() + 3000));
    expect(back).toMatchObject({ status: "SCHEDULED", evaluation: null, note: null, opportunityId: null });
    expect(await db.opportunity.count()).toBe(0);
    expect(await db.visitOutcomeHistory.count({ where: { visitId: v.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "visit.undone" } })).toBe(1);
  });

  it("recusa: fora da janela, outra pessoa, outra requisição ou alteração de resultado", async () => {
    const v = await visit(u.a.id);
    const at = new Date();
    await concludeVisit(u.a, v.id, { requestId: "undo-req-2", expectedVersion: 1, status: "NO_SHOW", note: "não veio" }, at);
    await expect(undoConclusion(u.a, v.id, "undo-req-2", new Date(at.getTime() + 60_000))).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(undoConclusion(u.manager, v.id, "undo-req-2", at)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(undoConclusion(u.a, v.id, "outra-req", at)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(undoConclusion(u.b, v.id, "undo-req-2", at)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const cur = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    await concludeVisit(u.a, v.id, { requestId: "undo-req-3", expectedVersion: cur.version, status: "CANCELED", note: "cancelou" }, new Date());
    await expect(undoConclusion(u.a, v.id, "undo-req-3", new Date())).rejects.toMatchObject({ code: "INVALID_STATE" }); // alteração não se desfaz
  });
});

describe("pré-visualização do imóvel", () => {
  const html = (img: string | null, title: string | null) =>
    `<html><head>${img ? `<meta property="og:image" content="${img}"/>` : ""}${title ? `<meta property="og:title" content="${title}"/>` : ""}</head></html>`;
  const fake = (pages: Record<string, { status: number; body: string }>) =>
    (async (url: string | URL | Request) => {
      const p = pages[String(url)] ?? { status: 404, body: "" };
      return new Response(p.body, { status: p.status });
    }) as typeof fetch;

  it("lê foto e título; só aceita https; trata ausência e erro", async () => {
    const tpl = "https://imob.exemplo.test/imovel/aluguel/{codigo}?tag=1";
    expect(propertyUrl(tpl, "00761")).toBe("https://imob.exemplo.test/imovel/aluguel/00761?tag=1");
    const f = fake({
      "https://a.test/1": { status: 200, body: html("https://img.test/1.jpg", "Apto 2 quartos &amp; vaga") },
      "https://a.test/2": { status: 200, body: html("http://inseguro.test/x.jpg", "Casa") },
      "https://a.test/3": { status: 200, body: "<html></html>" },
      "https://a.test/4": { status: 500, body: "" },
    });
    expect(await fetchPreview("https://a.test/1", f)).toMatchObject({ status: "OK", photoUrl: "https://img.test/1.jpg", title: "Apto 2 quartos & vaga" });
    expect((await fetchPreview("https://a.test/2", f)).photoUrl).toBeNull();
    expect((await fetchPreview("https://a.test/3", f)).status).toBe("NOT_FOUND");
    expect((await fetchPreview("https://a.test/4", f)).status).toBe("ERROR");
  });

  it("atualiza em lote imóveis com visitas recentes e não apaga foto em falha temporária", async () => {
    await db.appSettings.update({ where: { id: 1 }, data: { propertyUrlTemplate: "https://a.test/{codigo}" } });
    await visit(u.a.id, "1");
    await visit(u.a.id, "4");
    await db.property.update({ where: { code: "4" }, data: { photoUrl: "https://img.test/antiga.jpg" } });
    const f = fake({ "https://a.test/1": { status: 200, body: html("https://img.test/1.jpg", "Apto") }, "https://a.test/4": { status: 503, body: "" } });
    const r = await refreshPropertyPreviews({ fetchImpl: f, pauseMs: 0 });
    expect(r.updated).toBe(2);
    expect(await db.property.findUnique({ where: { code: "1" } })).toMatchObject({ photoUrl: "https://img.test/1.jpg", title: "Apto", pageStatus: "OK" });
    expect(await db.property.findUnique({ where: { code: "4" } })).toMatchObject({ photoUrl: "https://img.test/antiga.jpg", pageStatus: "ERROR" });
    expect((await refreshPropertyPreviews({ fetchImpl: f, pauseMs: 0 })).updated).toBe(0); // cache
  });
});

describe("respostas rápidas", () => {
  it("variam por resultado e são acrescentadas sem duplicar", () => {
    expect(quickNotesFor("DONE", "NEGATIVE")).toContain("Achou o valor total alto.");
    expect(quickNotesFor("NO_SHOW", null).length).toBeGreaterThan(0);
    expect(quickNotesFor(null, null)).toEqual([]);
    let n = appendNote("", "Vai pensar e dar retorno.");
    n = appendNote(n, "Vai pensar e dar retorno.");
    expect(n.trim()).toBe("Vai pensar e dar retorno.");
    expect(appendNote("Gostou", "Quer fazer uma proposta.").trim()).toBe("Gostou. Quer fazer uma proposta.");
  });
});

describe("dados de demonstração", () => {
  it("admin remove só as visitas [DEMO] (com oportunidade e cliente) e mantém as reais", async () => {
    const real = await visit(u.a.id);
    const demo = await createManualVisit(u.admin, { requestId: "demo-req-1", scheduledStart: "2026-10-06T09:00", clientName: "[DEMO] Mariana Alves", phoneRaw: "(51) 98888-7777", propertyCode: "761739", consultantId: u.b.id });
    await concludeVisit(u.b, demo.id, { requestId: "demo-done-1", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "ok" }, NOW);
    expect(await db.opportunity.count()).toBe(1);

    await expect(removeDemoData(u.a)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await removeDemoData(u.admin)).toBe(1);

    expect(await db.visit.findMany({ select: { id: true } })).toEqual([{ id: real.id }]);
    expect(await db.opportunity.count()).toBe(0);
    expect(await db.client.count({ where: { name: { startsWith: "[DEMO]" } } })).toBe(0);
  });
});
