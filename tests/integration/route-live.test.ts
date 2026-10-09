// Rota do dia, Ao vivo, lembretes de resultado (envio SIMULADO), termômetro e relatório do proprietário.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { concludeVisit, createManualVisit } from "@/server/visits";
import { sendResultReminders, type Sender } from "@/server/reminders";
import { dayRoute, setPropertyAddress } from "@/server/route";
import { liveBoard } from "@/server/live";
import { propertyHealth } from "@/server/thermometer";
import { buildOwnerReport } from "@/server/owner-report";
import { renderOwnerReportPdf } from "@/server/owner-report-pdf";
import { runSync } from "@/server/sync/engine";
import { toLocalInput } from "@/lib/time";
import { makeConnection, makeUsers, reason, resetDb } from "../helpers/db";
import { MockCalendar, visitEvent } from "../helpers/mock-calendar";

let u: Awaited<ReturnType<typeof makeUsers>>;
let seq = 0;
const NOW = new Date("2026-10-09T17:00:00Z"); // 14:00 em São Paulo
const MIN = 60_000;
const at = (min: number, consultantId: string, code = "761739", opts: { duration?: number; name?: string; base?: Date } = {}) =>
  createManualVisit(u.admin, {
    requestId: `rl-${++seq}-req`,
    scheduledStart: toLocalInput(new Date((opts.base ?? NOW).getTime() + min * MIN)),
    durationMinutes: opts.duration ?? 60,
    clientName: opts.name ?? "Cliente Secreto",
    phoneRaw: "",
    propertyCode: code,
    consultantId,
  });
const sub = (userId: string, tag: string) => ({ userId, endpoint: `https://push.test/${tag}`, p256dh: "chave-sintetica", auth: "auth-sint" });

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  await db.appSettings.update({ where: { id: 1 }, data: { remindersEnabled: true, resultPromptEnabled: true, resultReminderHours: 2, managerAlertHours: 24 } });
});

describe("lembretes de resultado", () => {
  it("pergunta ao terminar (com atalhos), lembra após 2 h e alerta a gestão após 24 h — uma vez cada, sem nome do cliente", async () => {
    const just = await at(-70, u.a.id, "111"); // terminou há 10 min
    await at(-240, u.a.id, "222"); // terminou há 3 h
    await at(-26 * 60, u.b.id, "333"); // terminou há 25 h
    await db.pushSubscription.createMany({ data: [sub(u.a.id, "a"), sub(u.b.id, "b"), sub(u.manager.id, "m")] });
    const sent: { endpoint: string; title: string; body: string; url: string; actions?: { url: string }[]; badge?: number }[] = [];
    const send: Sender = async (t, p) => (sent.push({ endpoint: t.endpoint, ...p }), "ok");
    await sendResultReminders(NOW, { send, email: null });

    const prompt = sent.find((s) => s.title.startsWith("Como foi"))!;
    expect(prompt.title).toBe("Como foi a visita das 12:50?");
    expect(prompt.url).toBe(`/visitas/${just.id}/registrar`);
    expect(prompt.actions!.map((a) => a.url)).toEqual([`/visitas/${just.id}/registrar?r=POSITIVE`, `/visitas/${just.id}/registrar?r=NEGATIVE`, `/visitas/${just.id}/registrar?r=NO_SHOW`]);
    expect(prompt.badge).toBe(2); // duas pendentes da consultora A
    expect(sent.find((s) => s.title.startsWith("Falta registrar"))!.title).toBe("Falta registrar a visita das 10:00");
    const mgr = sent.find((s) => s.endpoint.endsWith("/m"))!;
    expect(mgr.title).toBe("1 visita sem resultado há mais de 24 h");
    expect(mgr.body).toBe("Consultora 1");
    expect(sent).toHaveLength(3);
    expect(JSON.stringify(sent)).not.toContain("Secreto");

    await sendResultReminders(new Date(NOW.getTime() + MIN), { send, email: null });
    expect(sent).toHaveLength(3); // não repete
  });

  it("à noite só pergunta o resultado da visita que acabou de terminar", async () => {
    const night = new Date("2026-10-10T01:30:00Z"); // 22:30
    await at(-70, u.a.id, "111", { base: night });
    await at(-240, u.a.id, "222", { base: night });
    await db.pushSubscription.create({ data: sub(u.a.id, "a") });
    const sent: string[] = [];
    await sendResultReminders(night, { send: async (_t, p) => (sent.push(p.title), "ok"), email: null });
    expect(sent).toEqual(["Como foi a visita das 21:20?"]);
  });

  it("visita já registrada não gera aviso", async () => {
    const v = await at(-70, u.a.id);
    await concludeVisit(u.a, v.id, { requestId: "rl-done-req", expectedVersion: 1, status: "NO_SHOW", note: "não veio" }, NOW);
    await db.pushSubscription.create({ data: sub(u.a.id, "a") });
    const sent: string[] = [];
    await sendResultReminders(NOW, { send: async (_t, p) => (sent.push(p.title), "ok"), email: null });
    expect(sent).toEqual([]);
  });
});

describe("rota do dia", () => {
  it("ordena por horário, mede intervalos, marca intervalo apertado e monta a rota só com as próximas", async () => {
    await at(-120, u.a.id, "100"); // 12:00–13:00 (já passou)
    await at(60, u.a.id, "200"); // 15:00–16:00
    await at(130, u.a.id, "300"); // 16:10–17:10 (10 min depois, outro bairro)
    await at(200, u.a.id, "400"); // 17:20 sem endereço nem bairro
    await at(90, u.b.id, "500"); // de outra consultora
    await db.property.update({ where: { code: "100" }, data: { address: "Rua Um, 1", neighborhood: "Centro" } });
    await db.property.update({ where: { code: "200" }, data: { address: "Rua Dois, 2", neighborhood: "Centro" } });
    await db.property.update({ where: { code: "300" }, data: { neighborhood: "Igara" } });

    const r = await dayRoute(u.a, { consultantId: u.b.id }, NOW); // consultora não escolhe outra
    expect(r.consultantId).toBe(u.a.id);
    expect(r.stops.map((s) => s.propertyCode)).toEqual(["100", "200", "300", "400"]);
    expect(r.stops[2]).toMatchObject({ gapMin: 10, tight: true, loc: { query: "Igara, Canoas - RS", approximate: true } });
    expect(r.stops[1].tight).toBe(false);
    expect(r.remaining).toBe(2);
    expect(r.missing).toBe(1);
    const url = new URL(r.routeUrl!);
    expect(url.searchParams.get("waypoints")).toBe("Rua Dois, 2, Canoas - RS");
    expect(url.searchParams.get("destination")).toBe("Igara, Canoas - RS");
    expect(r.routeUrl).not.toContain("Secreto");

    const m = await dayRoute(u.manager, { consultantId: u.b.id }, NOW);
    expect(m.stops.map((s) => s.propertyCode)).toEqual(["500"]);
  });

  it("endereço digitado no app vale para as próximas visitas e a agenda não sobrescreve", async () => {
    await at(60, u.a.id, "654321");
    await expect(setPropertyAddress(u.b, "654321", "Rua Três, 3")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setPropertyAddress(u.a, "654321", "Rua Três, 3 - Centro");
    await makeConnection();
    const api = new MockCalendar();
    api.put(visitEvent("loc1", { start: "2026-10-09T19:00:00Z", extra: { location: "Av. da Agenda, 999" } }));
    await runSync({ api, now: NOW, sleep: async () => {} });
    expect(await db.property.findUniqueOrThrow({ where: { code: "654321" } })).toMatchObject({ address: "Rua Três, 3 - Centro", addressSource: "MANUAL" });

    // sem endereço manual: o campo "Local" do evento preenche
    api.put(visitEvent("loc2", { title: "Visita clt - Outro Cliente - cod 777 - (51) 99876-5400", start: "2026-10-09T20:00:00Z", extra: { location: "Rua da Agenda, 10" } }));
    await runSync({ api, now: NOW, sleep: async () => {} });
    expect(await db.property.findUniqueOrThrow({ where: { code: "777" } })).toMatchObject({ address: "Rua da Agenda, 10", addressSource: "AGENDA" });
  });
});

describe("ao vivo", () => {
  it("conta registradas, em andamento, sem resultado e próximas por consultora", async () => {
    const done = await at(-180, u.a.id);
    await concludeVisit(u.a, done.id, { requestId: "rl-live-done", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "gostou" }, NOW);
    await at(-30, u.a.id); // em andamento
    await at(-100, u.a.id, "761739", { duration: 30 }); // terminou 12:50, sem resultado
    await at(120, u.a.id); // próxima
    await expect(liveBoard(u.a, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { rows, team } = await liveBoard(u.manager, NOW);
    const a = rows.find((r) => r.id === u.a.id)!;
    expect(a).toMatchObject({ total: 4, done: 1, live: 1, awaiting: 1, upcoming: 1, positive: 1 });
    expect(a.current?.scheduledStart.getTime()).toBe(NOW.getTime() - 30 * MIN);
    expect(rows.find((r) => r.id === u.b.id)!.total).toBe(0);
    expect(team).toMatchObject({ total: 4, done: 1, live: 1, awaiting: 1 });
  });
});

describe("termômetro e relatório do proprietário", () => {
  it("marca imóvel encalhado pelo motivo, compara com parecidos e gera PDF sem dados pessoais", async () => {
    const preco = await reason("Preço/custo total");
    const mk = async (code: string, evals: ("POSITIVE" | "NEGATIVE")[]) => {
      for (const [i, e] of evals.entries()) {
        const v = await at(-(i + 2) * 24 * 60, u.a.id, code, { name: "Fulana Secreta" });
        await concludeVisit(u.a, v.id, { requestId: `rl-t-${code}-${i}`, expectedVersion: 1, status: "DONE", evaluation: e, negativeReasonId: e === "NEGATIVE" ? preco.id : null, note: "observação com nome Fulana" }, NOW);
      }
    };
    await mk("900", ["NEGATIVE", "NEGATIVE", "NEGATIVE", "NEGATIVE", "NEGATIVE"]);
    await mk("901", ["POSITIVE", "POSITIVE", "NEGATIVE"]);
    await mk("902", ["POSITIVE", "NEGATIVE", "POSITIVE"]);
    await db.property.updateMany({ where: { code: { in: ["900", "901", "902"] } }, data: { neighborhood: "Centro", category: "Apartamento", rent: 2000 } });

    const { rows } = await propertyHealth(u.manager, { now: NOW });
    const p = rows.find((r) => r.code === "900")!;
    expect(rows[0].code).toBe("900");
    expect(p).toMatchObject({ level: "stuck", done: 5, positive: 0, topReason: { label: "Preço/custo total", count: 5 } });
    expect(p.suggestion).toMatch(/valor/);
    expect(p.similar).toMatchObject({ properties: 2, rate: { num: 4, den: 6 } });
    await expect(propertyHealth(u.a)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const rep = await buildOwnerReport(u.manager, "900", "90", NOW, { photo: false });
    expect(rep.findings.join(" ")).toContain("Preço/custo total");
    expect(JSON.stringify(rep)).not.toMatch(/Fulana|Secreta|Consultora A/);
    const pdf = await renderOwnerReportPdf(rep);
    if (process.env.OWNER_PDF_OUT) (await import("node:fs")).writeFileSync(process.env.OWNER_PDF_OUT, pdf);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(await db.auditLog.count({ where: { action: "report.owner_pdf" } })).toBe(1);
  });
});
