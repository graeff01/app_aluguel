// Ficha única do cliente: pré-análise ligada ao cadastro (telefone, visita, retroativo), linha do tempo e escopo por perfil.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createPreAnalysis, runPreAnalysisRetention } from "@/server/pre-analysis";
import { concludeVisit, createManualVisit } from "@/server/visits";
import { startClientSearch } from "@/server/client-search";
import { createDocRequest } from "@/server/doc-requests";
import { mergeClients } from "@/server/clients";
import { backfillPreAnalysisLinks } from "@/server/client-links";
import { clientFile, resolveClientId } from "@/server/client-file";
import type { AuthzActor } from "@/lib/authz";
import { makeUsers, resetDb, guaranteeId } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE" };
const NOW = new Date("2026-10-13T15:00:00Z");
const PHONE = "(51) 99263-0924";
let seq = 0;

const pre = async (phone = PHONE, consultantId?: string) =>
  createPreAnalysis(
    jasmin,
    { fullName: "Ana Paula Longaray", birthDate: "1990-05-20", cpf: "", email: "", phone, salary: "", consultantId: consultantId ?? u.a.id, guaranteeId: await guaranteeId(), propertyCode: "843483", note: "", holderConfirmed: true },
    NOW,
  );
const visit = (consultantId: string, phone = PHONE, code = "843483", start = "2026-10-13T10:00") =>
  createManualVisit(u.admin, { requestId: `cf-visit-${++seq}`, scheduledStart: start, durationMinutes: 60, clientName: "Ana Paula Longaray", phoneRaw: phone, propertyCode: code, consultantId });
const negative = async (actor: AuthzActor, id: string) =>
  concludeVisit(actor, id, { requestId: `cf-done-${id}`, expectedVersion: 1, status: "DONE", evaluation: "NEGATIVE", negativeReasonId: (await db.reason.findFirstOrThrow({ where: { kind: "VISIT_NEGATIVE", label: "Características do imóvel" } })).id, note: "Nota interna: não gostou da planta" }, NOW);

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  const j = await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } });
  jasmin = { id: j.id, role: "PRE_SERVICE" };
});

describe("ligação da pré-análise ao cadastro", () => {
  it("pela impressão do telefone: depois (visita cria o cliente) e antes (cliente já existe); sem guardar o número em claro", async () => {
    const p1 = await pre();
    const r1 = await db.preAnalysis.findUniqueOrThrow({ where: { id: p1.id } });
    expect(r1.clientId).toBeNull();
    expect(r1.phoneHash).toBeTruthy();
    expect(JSON.stringify(r1)).not.toMatch(/992630924/);
    const v = await visit(u.a.id);
    expect((await db.preAnalysis.findUniqueOrThrow({ where: { id: p1.id } })).clientId).toBe(v.clientId);
    // cliente já existe: liga na hora
    const p2 = await pre();
    expect((await db.preAnalysis.findUniqueOrThrow({ where: { id: p2.id } })).clientId).toBe(v.clientId);
    // retenção (LGPD) apaga a impressão do telefone
    await runPreAnalysisRetention(new Date(NOW.getTime() + 400 * 86400_000));
    expect(await db.preAnalysis.findUniqueOrThrow({ where: { id: p2.id } })).toMatchObject({ phoneHash: null, clientId: v.clientId });
  });

  it("retroativo: pré-análises antigas são ligadas pelo worker (uma vez só)", async () => {
    const v = await visit(u.a.id);
    const p = await pre();
    await db.preAnalysis.update({ where: { id: p.id }, data: { phoneHash: null, clientId: null } });
    const sem = await pre("");
    expect(await backfillPreAnalysisLinks()).toMatchObject({ processed: 1, linked: 1 });
    expect((await db.preAnalysis.findUniqueOrThrow({ where: { id: p.id } })).clientId).toBe(v.clientId);
    expect((await db.preAnalysis.findUniqueOrThrow({ where: { id: sem.id } })).clientId).toBeNull();
    expect(await backfillPreAnalysisLinks()).toMatchObject({ processed: 0 });
  });
});

describe("ficha do cliente", () => {
  it("linha do tempo completa e o que cada perfil vê", async () => {
    const p = await pre();
    const v = await visit(u.a.id);
    await db.visit.update({ where: { id: v.id }, data: { preAnalysisId: p.id } });
    await negative(u.a, v.id);
    await startClientSearch(u.a, { visitId: v.id }, {}, NOW);
    await createDocRequest(u.a, { visitId: v.id, itemKeys: ["doc_foto"] }, NOW);
    const clientId = v.clientId!;

    const f = await clientFile(u.a, clientId, NOW);
    expect(new Set(f.timeline.map((e) => e.kind))).toEqual(new Set(["pre", "visit", "deal", "search", "docs"]));
    expect(f.timeline.find((e) => e.kind === "visit")).toMatchObject({ title: "Visitou · negativa", note: "Nota interna: não gostou da planta" });
    expect(f.now.activeSearch).toBeTruthy();
    expect(f.now.openDocs).toMatchObject({ done: 0, total: 1 });
    expect(f.stats).toMatchObject({ visits: 1, properties: 1 });
    expect(f.othersCount).toBe(0);
    expect(f.actions).toMatchObject({ scheduleFrom: v.id, docsFrom: v.id });

    // pré-atendimento: vê o histórico, sem observações internas e sem links da consultora
    const fp = await clientFile(jasmin, clientId, NOW);
    expect(fp.timeline.find((e) => e.kind === "visit")).toMatchObject({ note: null, href: undefined });
    expect(fp.actions).toEqual({ scheduleFrom: null, docsFrom: null });
    // gestão vê tudo
    expect((await clientFile(u.manager, clientId, NOW)).timeline.length).toBe(f.timeline.length);

    // outra consultora sem atendimento: não abre
    await expect(clientFile(u.b, clientId, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // com uma visita dela: vê só a dela + aviso de outro atendimento
    const vb = await visit(u.b.id, PHONE, "761739", "2026-10-13T12:00");
    const fb = await clientFile(u.b, clientId, NOW);
    expect(fb.timeline.map((e) => e.id)).toEqual([`visit-${vb.id}`]);
    expect(fb.othersCount).toBe(1);
    expect(fb.now.activeSearch).toBeNull();
  });

  it("unir cadastros leva pré-análises e busca; a ficha antiga aponta para a principal", async () => {
    const v1 = await visit(u.a.id);
    const v2 = await createManualVisit(u.admin, { requestId: "cf-other-visit", scheduledStart: "2026-10-13T11:00", durationMinutes: 60, clientName: "Ana P. Longaray", phoneRaw: "", propertyCode: "761739", consultantId: u.a.id });
    await negative(u.a, v2.id);
    const s2 = await startClientSearch(u.a, { visitId: v2.id }, { note: "Prefere térreo" }, NOW);
    await negative(u.a, v1.id);
    const s1 = await startClientSearch(u.a, { visitId: v1.id }, {}, NOW);
    const p = await pre();
    await mergeClients(u.manager, v2.clientId!, v1.clientId!);
    expect(await resolveClientId(v2.clientId!)).toBe(v1.clientId);
    expect((await db.preAnalysis.findUniqueOrThrow({ where: { id: p.id } })).clientId).toBe(v1.clientId);
    // duas buscas ativas: fica uma, com a anotação das duas
    expect(await db.clientSearch.findUnique({ where: { id: s2.id } })).toBeNull();
    expect((await db.clientSearch.findUniqueOrThrow({ where: { id: s1.id } })).note).toMatch(/Prefere térreo/);
    const f = await clientFile(u.a, v1.clientId!, NOW);
    expect(f.timeline.filter((e) => e.kind === "visit")).toHaveLength(2);
  });
});
