// Gestão: funil, oportunidades paradas, cobrança, resumo semanal, e-mail e registro de erros (dados sintéticos).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { concludeVisit, createManualVisit } from "@/server/visits";
import { updateOpportunity } from "@/server/opportunities";
import { listProperties, nudgeConsultant, opportunityFunnel, propertyDetail, staleOpportunities } from "@/server/insights";
import { sendDailyReminders, sendWeeklySummary, type Sender } from "@/server/reminders";
import { recordError, scrubMessage, scrubPath } from "@/lib/error-tracking";
import { makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
let seq = 0;
const visit = (consultantId: string, start: string, code = "100", name = "Cliente Sintético", phone = "") =>
  createManualVisit(u.admin, { requestId: `mg-${++seq}-req`, scheduledStart: start, clientName: name, phoneRaw: phone, propertyCode: code, consultantId });
const conclude = (actor: { id: string; role: "ADMIN" | "MANAGER" | "CONSULTANT" }, id: string, evaluation: "POSITIVE" | "NEGATIVE" | "UNDECIDED", now: Date) =>
  concludeVisit(actor, id, { requestId: `conclude-${++seq}-req`, expectedVersion: 1, status: "DONE", evaluation, negativeReasonId: null, note: "ok" }, now);

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

describe("funil de locação", () => {
  it("coorte: iniciadas → positivas → documentação → fechadas, com tempos médios", async () => {
    const now = new Date("2026-09-20T15:00:00Z");
    const v1 = await visit(u.a.id, "2026-09-01T10:00", "1", "Ana Teste", "(51) 99111-0001");
    const v2 = await visit(u.a.id, "2026-09-02T10:00", "2", "Bia Teste", "(51) 99111-0002");
    const v3 = await visit(u.b.id, "2026-09-03T10:00", "3", "Caio Teste", "(51) 99111-0003");
    await conclude(u.a, v1.id, "POSITIVE", now);
    await conclude(u.a, v2.id, "UNDECIDED", now);
    await conclude(u.b, v3.id, "POSITIVE", now);
    const o1 = await db.opportunity.findFirstOrThrow({ where: { property: { code: "1" } } });
    await updateOpportunity(u.manager, o1.id, { expectedVersion: o1.version, toStatus: "DOCS_REVIEW" });
    const o1b = await db.opportunity.findUniqueOrThrow({ where: { id: o1.id } });
    await updateOpportunity(u.manager, o1.id, { expectedVersion: o1b.version, toStatus: "CLOSED_WON", closedAt: "2026-09-10" });
    const f = await opportunityFunnel(u.manager, { from: "2026-09-01", to: "2026-10-31" });
    expect(f.steps.map((s) => s.count)).toEqual([3, 2, 1, 1]);
    expect(f.daysToClose).toBe(9);
    expect(f.open).toBe(2);
    const fa = await opportunityFunnel(u.manager, { from: "2026-09-01", to: "2026-10-31", consultantId: u.b.id });
    expect(fa.steps[0].count).toBe(1);
    await expect(opportunityFunnel(u.a, { from: "2026-09-01", to: "2026-10-31" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("oportunidades paradas", () => {
  it("destaca abertas sem movimento há mais de N dias", async () => {
    const v = await visit(u.a.id, "2026-09-01T10:00");
    await conclude(u.a, v.id, "POSITIVE", new Date("2026-09-01T20:00:00Z"));
    await db.opportunityEvent.updateMany({ data: { createdAt: new Date("2026-09-01T20:00:00Z") } });
    await db.opportunity.updateMany({ data: { createdAt: new Date("2026-09-01T20:00:00Z") } });
    const stale = await staleOpportunities(u.manager, new Date("2026-09-20T12:00:00Z"));
    expect(stale).toHaveLength(1);
    expect(stale[0].idleDays).toBe(18);
    expect(await staleOpportunities(u.manager, new Date("2026-09-05T12:00:00Z"))).toHaveLength(0);
  });
});

describe("imóveis", () => {
  it("lista e detalha com métricas; consultora não acessa", async () => {
    const now = new Date("2026-10-20T15:00:00Z");
    const v = await visit(u.a.id, "2026-10-01T10:00", "777");
    await conclude(u.a, v.id, "POSITIVE", now);
    const list = await listProperties(u.manager);
    expect(list.find((p) => p.code === "777")).toMatchObject({ visits: 1, done: 1, positive: 1 });
    const d = await propertyDetail(u.manager, "777", now);
    expect(d.metrics.positiveRate.value).toBe(1);
    await expect(listProperties(u.a)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(propertyDetail(u.a, "777")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("cobrar pendências", () => {
  it("sem pendência informa; sem aparelho recusa; só gestão", async () => {
    expect(await nudgeConsultant(u.manager, u.a.id)).toContain("não tem pendências");
    await visit(u.a.id, "2026-09-01T10:00");
    await expect(nudgeConsultant(u.manager, u.a.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(nudgeConsultant(u.a, u.b.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("resumo semanal e e-mail", () => {
  it("segunda-feira: gestora recebe números da semana anterior uma única vez", async () => {
    const monday = new Date("2026-10-12T13:00:00Z"); // seg 10:00 em SP
    const v = await visit(u.a.id, "2026-10-06T10:00");
    await conclude(u.a, v.id, "POSITIVE", new Date("2026-10-06T20:00:00Z"));
    await db.pushSubscription.create({ data: { userId: u.manager.id, endpoint: "https://push.test/g", p256dh: "chave-sintetica", auth: "auth-sint" } });
    const sent: { title: string; body: string }[] = [];
    const send: Sender = async (_t, p) => (sent.push(p), "ok");
    expect(await sendWeeklySummary(new Date("2026-10-13T13:00:00Z"), { send, email: null })).toEqual({ skipped: "NOT_TIME" });
    await sendWeeklySummary(monday, { send, email: null });
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Semana passada: 1 visita realizada");
    expect(sent[0].body).toContain("Positivas 100%");
    await sendWeeklySummary(new Date(monday.getTime() + 3600_000), { send, email: null });
    expect(sent).toHaveLength(1);
  });

  it("sem notificação no celular, o lembrete diário vai por e-mail (só contagem e link)", async () => {
    await visit(u.a.id, "2026-10-01T10:00", "1", "Nome Confidencial");
    const mails: { to: string; subject: string; text: string }[] = [];
    const email = async (to: string, subject: string, text: string) => (mails.push({ to, subject, text }), true);
    const pushes: unknown[] = [];
    await sendDailyReminders(new Date("2026-10-06T13:00:00Z"), { send: async (_t, p) => (pushes.push(p), "ok"), email });
    expect(pushes).toHaveLength(0);
    const toA = mails.find((m) => m.to === "a@exemplo.test")!;
    expect(toA.subject).toBe("1 visita aguardando resultado");
    expect(toA.text).toContain("/minhas");
    expect(JSON.stringify(mails)).not.toContain("Confidencial");
    expect(mails.find((m) => m.to === "gestora@exemplo.test")?.subject).toContain("Equipe: 1 visita");
  });
});

describe("registro de erros", () => {
  it("remove dados pessoais e agrupa por assinatura", async () => {
    expect(scrubMessage("Falha ao salvar fulana@exemplo.test tel (51) 99876-5432 id cmux1234567890abcdefghijk")).toBe("Falha ao salvar [email] tel [número] id [id]");
    expect(scrubPath("/visitas/cmux1234567890abcdefghijk/registrar?x=1")).toBe("/visitas/:id/registrar");
    await recordError({ source: "client", message: "Quebrou para (51) 99876-5432", path: "/minhas" });
    await recordError({ source: "client", message: "Quebrou para (51) 91111-2222", path: "/minhas" });
    const rows = await db.errorEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 2, message: "Quebrou para [número]" });
  });
});
