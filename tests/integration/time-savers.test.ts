// Economia de tempo: pré-análise → visita, confirmação de presença, agenda do dia, rodízio por carga, retornos.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { assignmentQueue, createPreAnalysis, preAnalysisStats, resolvePreAnalysis } from "@/server/pre-analysis";
import { scheduleFromPreAnalysis } from "@/server/pre-visit";
import { calendarLinkFor } from "@/server/reschedule";
import { setPresence } from "@/server/presence";
import { dayAgenda } from "@/server/day-agenda";
import { dueFollowUps, followUpAction } from "@/server/followups";
import { sendOperationalAlerts } from "@/server/reminders";
import { concludeVisit, createManualVisit } from "@/server/visits";
import { buildConfirmMessage, whatsappUrl } from "@/lib/confirm";
import { toLocalInput } from "@/lib/time";
import { guaranteeId, makeConnection, makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
let gId = "";
const NOW = new Date("2026-10-13T15:00:00Z"); // terça 12:00 SP
const H = 3600_000;
const pre = (o: Record<string, unknown> = {}) => ({ fullName: "Maria Titular da Silva", birthDate: "1990-05-20", cpf: "529.982.247-25", email: "maria@exemplo.test", phone: "(51) 99876-1234", salary: "4.500,00", consultantId: u.a.id, guaranteeId: gId, propertyCode: "761739", note: "", holderConfirmed: true as const, ...o });

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  const j = await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } });
  jasmin = { id: j.id, role: "PRE_SERVICE" };
  gId = await guaranteeId();
  await db.appSettings.update({ where: { id: 1 }, data: { remindersEnabled: true } });
});

describe("pré-análise aprovada → visita", () => {
  it("cria a visita com nome, telefone e imóvel, ligada à pré-análise; funil conta", async () => {
    await makeConnection();
    const p = await createPreAnalysis(jasmin, pre(), NOW);
    const input = { requestId: "pv1", scheduledStart: toLocalInput(new Date("2026-10-14T18:00:00Z")), durationMinutes: 60, propertyCode: "761739" };
    await expect(scheduleFromPreAnalysis(u.a, p.id, input, NOW)).rejects.toMatchObject({ code: "INVALID_STATE" }); // ainda não aprovada
    await resolvePreAnalysis(u.a, p.id, { status: "APPROVED", note: "Aprovado sem fiador" }, NOW);
    await expect(scheduleFromPreAnalysis(u.b, p.id, input, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const v = await scheduleFromPreAnalysis(u.a, p.id, input, NOW);
    expect(v).toMatchObject({ clientName: "Maria Titular da Silva", phoneNormalized: "+5551998761234", propertyCode: "761739", consultantId: u.a.id, preAnalysisId: p.id, assignmentNote: "PRE_ANALISE" });
    expect((await scheduleFromPreAnalysis(u.a, p.id, input, NOW)).id).toBe(v.id); // reenvio não duplica
    expect(new URL((await calendarLinkFor(u.a, v.id)).url).searchParams.get("details")).toContain("pré-análise aprovada");
    const s = await preAnalysisStats(u.manager, new Date("2026-10-01T03:00:00Z"), new Date("2026-11-01T03:00:00Z"));
    expect(s).toMatchObject({ total: 1, approved: 1, withVisit: 1, visited: 0, leased: 0 });
  });
});

describe("confirmação de presença", () => {
  it("mensagem pronta para o WhatsApp e registro da resposta", async () => {
    const msg = buildConfirmMessage("Olá, {cliente}! Aqui é {consultora}. Visita {dia} às {hora} no imóvel {codigo}{bairro}.", { clientName: "Maria Silva", consultantName: "Eduarda Schuler", scheduledStart: new Date("2026-10-14T18:00:00Z"), propertyCode: "761739", neighborhood: "Centro" }, NOW);
    expect(msg).toBe("Olá, Maria! Aqui é Eduarda. Visita amanhã às 15:00 no imóvel 761739 (Centro).");
    expect(whatsappUrl("+5551998761234", msg)).toBe(`https://wa.me/5551998761234?text=${encodeURIComponent(msg)}`);
    const v = await createManualVisit(u.admin, { requestId: "conf-req-1", scheduledStart: toLocalInput(new Date("2026-10-14T18:00:00Z")), clientName: "Maria Silva", phoneRaw: "(51) 99876-1234", propertyCode: "761739", consultantId: u.a.id });
    await expect(setPresence(u.b, v.id, "CONFIRMED")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setPresence(u.a, v.id, "CONFIRMED");
    expect(await db.visit.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ confirmStatus: "CONFIRMED" });
  });

  it("às 16h lembra a consultora de confirmar as visitas de amanhã", async () => {
    await createManualVisit(u.admin, { requestId: "conf-req-2", scheduledStart: toLocalInput(new Date("2026-10-14T18:00:00Z")), clientName: "Cliente Amanhã", phoneRaw: "(51) 99876-1111", propertyCode: "761739", consultantId: u.a.id });
    await db.pushSubscription.create({ data: { userId: u.a.id, endpoint: "https://push.test/a", p256dh: "k", auth: "a" } });
    const t: string[] = [];
    await sendOperationalAlerts(new Date("2026-10-13T19:30:00Z"), { send: async (_x, p) => (t.push(p.title), "ok"), email: null }); // 16:30 SP
    expect(t).toContain("Confirme a visita de amanhã");
  });
});

describe("agenda do dia do pré-atendimento", () => {
  it("vê todas as consultoras e as visitas sem consultora; consultora não acessa", async () => {
    await createManualVisit(u.admin, { requestId: "ag-req-1", scheduledStart: toLocalInput(new Date("2026-10-13T17:00:00Z")), clientName: "Cliente A", phoneRaw: "", propertyCode: "1", consultantId: u.a.id });
    await db.visit.create({ data: { origin: "GOOGLE", assignmentStatus: "NEEDS_REVIEW", clientName: "Sem Dona", scheduledStart: new Date("2026-10-13T18:00:00Z"), scheduledEnd: new Date("2026-10-13T19:00:00Z") } });
    const a = await dayAgenda(jasmin, "2026-10-13");
    expect(a).toMatchObject({ visits: 2, unassigned: 1 });
    expect(a.groups[0].name).toBe("Sem consultora");
    await expect(dayAgenda(u.a, "2026-10-13")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("rodízio por carga", () => {
  it("vai para quem tem menos em aberto, mesmo que seja a vez da outra", async () => {
    await createPreAnalysis(jasmin, pre({ consultantId: u.a.id }), new Date(NOW.getTime() - 3 * H));
    await createPreAnalysis(jasmin, pre({ consultantId: u.a.id, cpf: "168.995.350-09" }), new Date(NOW.getTime() - 2 * H));
    const b = await createPreAnalysis(jasmin, pre({ consultantId: u.b.id, cpf: "390.533.447-05" }), new Date(NOW.getTime() - H));
    await resolvePreAnalysis(u.b, b.id, { status: "APPROVED", note: "Aprovado" }, NOW);
    // B recebeu por último, mas A tem 2 em aberto e B nenhuma
    expect((await assignmentQueue(NOW)).find((c) => c.isNext)?.id).toBe(u.b.id);
  });
});

describe("retornos do ainda decidindo", () => {
  it("marca o dia de ligar, aparece no dia, some com nova visita ou quando feito", async () => {
    const v = await createManualVisit(u.admin, { requestId: "fu-req-1", scheduledStart: toLocalInput(new Date("2026-10-13T13:00:00Z")), clientName: "Cliente Pensa", phoneRaw: "(51) 99876-2222", propertyCode: "761739", consultantId: u.a.id });
    await concludeVisit(u.a, v.id, { requestId: "fu-conclude-1", expectedVersion: 1, status: "DONE", evaluation: "UNDECIDED", note: "Vai pensar", followUpDays: 1 }, NOW);
    expect((await db.visit.findUniqueOrThrow({ where: { id: v.id } })).followUpOn?.toISOString().slice(0, 10)).toBe("2026-10-14");
    expect(await dueFollowUps(u.a.id, NOW)).toHaveLength(0);
    const tomorrow = new Date("2026-10-14T15:00:00Z");
    expect((await dueFollowUps(u.a.id, tomorrow)).map((x) => x.id)).toEqual([v.id]);
    await followUpAction(u.a, v.id, "snooze", tomorrow);
    expect(await dueFollowUps(u.a.id, tomorrow)).toHaveLength(0);
    const later = new Date("2026-10-16T15:00:00Z");
    expect(await dueFollowUps(u.a.id, later)).toHaveLength(1);
    await followUpAction(u.a, v.id, "done", later);
    expect(await dueFollowUps(u.a.id, later)).toHaveLength(0);
  });

  it("nova visita marcada para o cliente tira o retorno da lista", async () => {
    const v = await createManualVisit(u.admin, { requestId: "fu-req-2", scheduledStart: toLocalInput(new Date("2026-10-13T13:00:00Z")), clientName: "Cliente Volta", phoneRaw: "(51) 99876-3333", propertyCode: "761739", consultantId: u.a.id });
    await concludeVisit(u.a, v.id, { requestId: "fu-conclude-2", expectedVersion: 1, status: "DONE", evaluation: "UNDECIDED", note: "Vai pensar", followUpDays: 0 }, NOW);
    expect(await dueFollowUps(u.a.id, NOW)).toHaveLength(1);
    await createManualVisit(u.admin, { requestId: "fu-req-3", scheduledStart: toLocalInput(new Date("2026-10-15T13:00:00Z")), clientName: "Cliente Volta", phoneRaw: "(51) 99876-3333", propertyCode: "222222", consultantId: u.a.id });
    expect(await dueFollowUps(u.a.id, NOW)).toHaveLength(0);
  });
});
