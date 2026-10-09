// LGPD (anonimização e retenção) e relatório mensal — dados sintéticos; Google SIMULADO.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { concludeVisit, createManualVisit } from "@/server/visits";
import { anonymizeClient, ANON_NAME, runRetention } from "@/server/privacy";
import { buildMonthlyReport } from "@/server/report";
import { renderMonthlyReportPdf } from "@/server/report-pdf";
import { runSync } from "@/server/sync/engine";
import { MockCalendar, visitEvent } from "../helpers/mock-calendar";
import { makeConnection, makeUsers, reason, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
let seq = 0;
const visit = (consultantId: string, start: string, name = "Fulana de Tal", phone = "(51) 99555-0101", code = "761739") =>
  createManualVisit(u.admin, { requestId: `pr-${++seq}-req`, scheduledStart: start, clientName: name, phoneRaw: phone, propertyCode: code, consultantId });
const done = (actor: { id: string; role: "ADMIN" | "MANAGER" | "CONSULTANT" }, id: string, evaluation: "POSITIVE" | "NEGATIVE" | "UNDECIDED", negativeReasonId: string | null = null) =>
  concludeVisit(actor, id, { requestId: `prd-${++seq}-req`, expectedVersion: 1, status: "DONE", evaluation, negativeReasonId, note: "Ligou para Fulana no 51 99555-0101" }, new Date("2026-10-08T12:00:00Z"));

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

describe("LGPD", () => {
  it("anonimiza nome, telefones e observações, preservando os indicadores", async () => {
    const v = await visit(u.a.id, "2026-09-10T10:00");
    await done(u.a, v.id, "POSITIVE");
    const before = await buildMonthlyReport(u.manager, "2026-09", new Date("2026-10-08T12:00:00Z"));
    await expect(anonymizeClient(u.a, v.clientId!, "pedido")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(anonymizeClient(u.manager, v.clientId!, "")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await anonymizeClient(u.manager, v.clientId!, "pedido do titular")).toBe(true);
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id }, include: { client: { include: { phones: true } }, history: true } });
    expect(after).toMatchObject({ clientName: ANON_NAME, phoneRaw: null, phoneNormalized: null, status: "DONE", evaluation: "POSITIVE" });
    expect(after.note).not.toContain("Fulana");
    expect(after.history.every((h) => !h.note?.includes("Fulana"))).toBe(true);
    expect(after.client?.phones).toHaveLength(0);
    expect(after.client?.anonymizedAt).not.toBeNull();
    const again = await buildMonthlyReport(u.manager, "2026-09", new Date("2026-10-08T12:00:00Z"));
    expect(again.team.done).toBe(before.team.done);
    expect(again.team.positiveRate).toEqual(before.team.positiveRate);
    expect(await db.auditLog.count({ where: { action: "client.anonymized" } })).toBe(1);
  });

  it("sincronização não traz de volta os dados de cliente anonimizado", async () => {
    await makeConnection();
    const api = new MockCalendar();
    api.put(visitEvent("ev-lgpd", { start: "2026-10-07T13:00:00Z", title: "Visita clt - Fulana de Tal - cod 761739 - (51) 99555-0101" }));
    const NOW = new Date("2026-10-06T15:00:00Z");
    await runSync({ api, now: NOW, sleep: async () => {} });
    const v = await db.visit.findFirstOrThrow();
    await anonymizeClient(u.manager, v.clientId!, "pedido do titular");
    api.put(visitEvent("ev-lgpd", { start: "2026-10-07T14:00:00Z", title: "Visita clt - Fulana de Tal - cod 761739 - (51) 99555-0101" }));
    await runSync({ api, now: new Date(NOW.getTime() + 60_000), sleep: async () => {} });
    const after = await db.visit.findUniqueOrThrow({ where: { id: v.id }, include: { sourceEvent: true } });
    expect(after.clientName).toBe(ANON_NAME);
    expect(after.phoneRaw).toBeNull();
    expect(after.sourceEvent?.title).toBeNull();
  });

  it("retenção anonimiza só clientes inativos há mais de N meses", async () => {
    await db.appSettings.update({ where: { id: 1 }, data: { retentionMonths: 24 } });
    const old = await visit(u.a.id, "2023-05-10T10:00", "Antigo Cliente", "(51) 99555-0202");
    const recent = await visit(u.a.id, "2026-09-10T10:00", "Recente Cliente", "(51) 99555-0303");
    await db.client.update({ where: { id: old.clientId! }, data: { createdAt: new Date("2023-05-10T13:00:00Z") } });
    const r = await runRetention(new Date("2026-10-08T12:00:00Z"), { force: true });
    expect(r.anonymized).toBe(1);
    expect((await db.client.findUniqueOrThrow({ where: { id: old.clientId! } })).anonymizedAt).not.toBeNull();
    expect((await db.client.findUniqueOrThrow({ where: { id: recent.clientId! } })).anonymizedAt).toBeNull();
    await db.appSettings.update({ where: { id: 1 }, data: { retentionMonths: 0 } });
    expect((await runRetention(new Date(), { force: true })).skipped).toBe("DISABLED");
  });
});

describe("relatório mensal", () => {
  it("consolida equipe e consultoras, compara com o mês anterior e gera PDF", async () => {
    const preco = (await reason("Preço/custo total")).id;
    // agosto: 2 realizadas (1 positiva)
    for (const [i, ev] of (["POSITIVE", "NEGATIVE"] as const).entries()) {
      const v = await visit(u.a.id, `2026-08-1${i}T10:00`, `Cliente Ago ${i}`, `(51) 99666-010${i}`, `10${i}`);
      await done(u.a, v.id, ev, ev === "NEGATIVE" ? preco : null);
    }
    // setembro: A 3 realizadas (2 positivas), B 1 realizada negativa + 1 não compareceu
    for (const [i, ev] of (["POSITIVE", "POSITIVE", "UNDECIDED"] as const).entries()) {
      const v = await visit(u.a.id, `2026-09-1${i}T10:00`, `Cliente Set ${i}`, `(51) 99777-010${i}`, `20${i}`);
      await done(u.a, v.id, ev);
    }
    const vb = await visit(u.b.id, "2026-09-20T10:00", "Cliente B", "(51) 99888-0101", "300");
    await done(u.b, vb.id, "NEGATIVE", preco);
    const ns = await visit(u.b.id, "2026-09-21T10:00", "Cliente B2", "(51) 99888-0102", "301");
    await concludeVisit(u.b, ns.id, { requestId: "pr-noshow-req", expectedVersion: 1, status: "NO_SHOW", note: "não veio" }, new Date("2026-10-08T12:00:00Z"));

    const r = await buildMonthlyReport(u.manager, "2026-09", new Date("2026-10-08T12:00:00Z"));
    expect(r.label).toBe("setembro de 2026");
    expect(r.team).toMatchObject({ scheduled: 5, done: 4, noShow: 1 });
    expect(r.team.positiveRate).toEqual({ num: 2, den: 4, value: 0.5 });
    expect(r.teamPrev.done).toBe(2);
    const a = r.perConsultant.find((c) => c.id === u.a.id)!;
    const b = r.perConsultant.find((c) => c.id === u.b.id)!;
    expect(a.kpis.positiveRate.value).toBeCloseTo(2 / 3);
    expect(b.kpis.noShowRate).toEqual({ num: 1, den: 2, value: 0.5 });
    expect(b.topReason?.label).toBe("Preço/custo total");
    expect(r.series).toHaveLength(6);
    expect(r.series.at(-1)).toMatchObject({ month: "2026-09", done: 4 });
    expect(r.highlights.some((h) => h.text.includes("Visitas realizadas cresceram 100%"))).toBe(true);
    await expect(buildMonthlyReport(u.a, "2026-09")).rejects.toMatchObject({ code: "FORBIDDEN" });

    const pdf = await renderMonthlyReportPdf(r);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20_000);
  });
});
