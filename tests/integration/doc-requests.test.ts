// Documentos pelo link do cliente: token, verificação, travas, cifragem, escopo, conclusão, pasta única e retenção (LGPD).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createPreAnalysis, resolvePreAnalysis } from "@/server/pre-analysis";
import {
  cancelDocRequest,
  clientDocView,
  createDocRequest,
  docRequestShare,
  listDocRequests,
  readClientDocument,
  removeClientDocument,
  renewDocRequest,
  runDocRequestRetention,
  submitClientDocuments,
  suggestedItemKeys,
  uploadClientDocument,
  verifyClient,
} from "@/server/doc-requests";
import { concludeVisit, createManualVisit } from "@/server/visits";
import { makeUsers, resetDb, guaranteeId } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
let jasmin: { id: string; role: "PRE_SERVICE"; name: string };
const NOW = new Date("2026-10-13T15:00:00Z");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);
const jpeg = (n = 2000) => new File([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)])], "IMG_0001.jpg", { type: "image/jpeg" });
const pdf = () => new File([Buffer.from("%PDF-1.4\n% documento sintético\n")], "holerite.pdf", { type: "application/pdf" });
const tokenOf = (url: string) => url.split("/d/")[1];

async function preAnalysis(o: { pending?: boolean } = {}) {
  const p = await createPreAnalysis(
    jasmin,
    { fullName: "Maria Titular da Silva", birthDate: "1990-05-20", cpf: "529.982.247-25", email: "maria@exemplo.test", phone: "(51) 99876-1234", salary: "4.500,00", consultantId: u.a.id, guaranteeId: await guaranteeId(), propertyCode: "761739", note: "", holderConfirmed: true },
    NOW,
  );
  if (o.pending) await resolvePreAnalysis(u.a, p.id, { status: "PENDING", note: "Falta comprovante de renda" }, NOW);
  return p;
}

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
  const j = await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } });
  jasmin = { id: j.id, role: "PRE_SERVICE", name: j.name };
});

describe("link de documentos", () => {
  it("pré-análise: cliente confirma pelo CPF, envia cifrado, conclui e a pré-análise pendente volta para análise", async () => {
    const p = await preAnalysis({ pending: true });
    const r = await createDocRequest(jasmin, { preAnalysisId: p.id, itemKeys: ["doc_foto", "renda", "estado_civil"], custom: ["Contracheque do cônjuge"] }, NOW);
    expect(r).toMatchObject({ reused: false, added: 4, phone: "+5551998761234" });
    const token = tokenOf(r.url);
    expect(token.length).toBeGreaterThanOrEqual(43);

    // nada sensível em claro no banco: nem token, nem telefone, nem dígitos de verificação
    const raw = await db.docRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(JSON.stringify(raw)).not.toMatch(new RegExp(`${token}|998761234|529`));
    expect(raw.verifyKind).toBe("CPF");

    // sem sessão: só o primeiro nome, nenhum documento
    const before = await clientDocView(token, undefined, later(1));
    expect(before).toMatchObject({ state: "OK", verified: false, firstName: "Maria", verifyKind: "CPF", consultant: "Consultora A" });
    expect(JSON.stringify(before)).not.toMatch(/Titular|items/);
    await expect(uploadClientDocument(token, undefined, "doc_foto", jpeg(), later(1))).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(verifyClient(token, "12", later(2))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(verifyClient(token, "999", later(2))).rejects.toMatchObject({ code: "VALIDATION" });
    const session = await verifyClient(token, "529", later(2));
    const view = await clientDocView(token, session, later(3));
    expect(view).toMatchObject({ verified: true, status: "OPEN" });

    // envio: tipo conferido pelo conteúdo, item precisa estar na lista
    await expect(uploadClientDocument(token, session, "fiador_doc", jpeg(), later(4))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(uploadClientDocument(token, session, "doc_foto", new File([Buffer.from("MZ executável")], "rg.jpg", { type: "image/jpeg" }), later(4))).rejects.toMatchObject({ code: "VALIDATION" });
    const f1 = await uploadClientDocument(token, session, "doc_foto", jpeg(), later(4));
    expect(f1.name).toBe("Documento com foto (RG ou CNH).jpg");
    await uploadClientDocument(token, session, "doc_foto", jpeg(), later(4));
    const stored = await db.clientDocument.findUniqueOrThrow({ where: { id: f1.id } });
    expect(Buffer.from(stored.data).subarray(28, 32).equals(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false); // cifrado

    // obrigatórios faltando: não conclui
    await expect(submitClientDocuments(token, session, later(5))).rejects.toMatchObject({ code: "VALIDATION" });
    await uploadClientDocument(token, session, "renda", pdf(), later(5));
    const extra = (raw.items as { key: string; label: string }[]).find((i) => i.label === "Contracheque do cônjuge")!;
    const wrong = await uploadClientDocument(token, session, extra.key, jpeg(), later(5));
    await removeClientDocument(token, session, wrong.id, later(5));
    await expect(submitClientDocuments(token, session, later(6))).rejects.toMatchObject({ code: "VALIDATION" });
    await uploadClientDocument(token, session, extra.key, pdf(), later(6));
    await submitClientDocuments(token, session, later(7)); // certidão é opcional
    expect((await db.preAnalysis.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("AWAITING");
    // depois de concluir, não envia mais pelo mesmo link
    await expect(uploadClientDocument(token, session, "doc_foto", jpeg(), later(8))).rejects.toMatchObject({ code: "INVALID_STATE" });

    // equipe: consultora e pré-atendimento veem; outra consultora não
    const [list] = await listDocRequests(u.a, { preAnalysisId: p.id }, later(9));
    expect(list).toMatchObject({ status: "SUBMITTED", done: 3, total: 4 });
    expect(await listDocRequests(u.b, { preAnalysisId: p.id }, later(9))).toHaveLength(0);
    const file = await readClientDocument(u.a, f1.id);
    expect(file.data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    await expect(readClientDocument(u.b, f1.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "docrequest.file_viewed", entityId: r.id } })).toBe(1);
  });

  it("verificação trava após 5 erros; renovar destrava; cancelado e expirado não abrem", async () => {
    const p = await preAnalysis();
    const r = await createDocRequest(jasmin, { preAnalysisId: p.id, itemKeys: ["doc_foto"] }, NOW);
    const token = tokenOf(r.url);
    for (let i = 0; i < 4; i++) await expect(verifyClient(token, "111", later(1))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(verifyClient(token, "111", later(1))).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(verifyClient(token, "529", later(2))).rejects.toMatchObject({ code: "RATE_LIMITED" }); // travado mesmo com o certo
    await renewDocRequest(u.a, r.id, later(3));
    expect(await verifyClient(token, "529", later(3))).toBeTruthy();

    // sessão de outro pedido não vale
    const v = await createManualVisit(u.admin, { requestId: "doc-visit-1", scheduledStart: "2026-10-13T10:00", clientName: "Bruno Cliente", phoneRaw: "(51) 99876-4321", propertyCode: "767207", consultantId: u.b.id });
    const r2 = await createDocRequest(u.b, { visitId: v.id, itemKeys: ["renda"] }, NOW);
    const s2 = await verifyClient(tokenOf(r2.url), "4321", later(4)); // sem CPF: 4 últimos do celular
    await expect(uploadClientDocument(token, s2, "doc_foto", jpeg(), later(4))).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect((await clientDocView(token, undefined, new Date(NOW.getTime() + 8 * 86400_000))).state).toBe("EXPIRED");
    await cancelDocRequest(u.a, r.id, later(5));
    expect((await clientDocView(token, undefined, later(6))).state).toBe("CANCELED");
    expect((await clientDocView("token-que-nao-existe-aaaaaaaaaaaaaaaaaaaaaaaaaaa", undefined, later(6))).state).toBe("INVALID");
    await expect(cancelDocRequest(u.b, r.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("pasta única: pedir de novo depois da visita inclui os itens no mesmo link; retenção apaga tudo", async () => {
    const p = await preAnalysis();
    const first = await createDocRequest(jasmin, { preAnalysisId: p.id, itemKeys: ["doc_foto"] }, NOW);
    const v = await createManualVisit(u.admin, { requestId: "doc-visit-2", scheduledStart: "2026-10-13T10:00", clientName: "Maria Titular da Silva", phoneRaw: "(51) 99876-1234", propertyCode: "761739", consultantId: u.a.id });
    await db.visit.update({ where: { id: v.id }, data: { preAnalysisId: p.id } });
    await concludeVisit(u.a, v.id, { requestId: "doc-visit-2-done", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "Gostou" }, later(60));
    const again = await createDocRequest(u.a, { visitId: v.id, itemKeys: ["doc_foto", "residencia"] }, later(61));
    expect(again).toMatchObject({ id: first.id, reused: true, added: 1, url: first.url });
    const share = await docRequestShare(u.a, first.id);
    expect(share).toMatchObject({ url: first.url, phone: "+5551998761234" });
    expect((await listDocRequests(u.a, { visitId: v.id }, later(62)))[0]).toMatchObject({ id: first.id, total: 2 });

    const s = await verifyClient(tokenOf(first.url), "529", later(63));
    await uploadClientDocument(tokenOf(first.url), s, "doc_foto", jpeg(), later(63));
    expect(await db.clientDocument.count()).toBe(1);
    await runDocRequestRetention(new Date(NOW.getTime() + 400 * 86400_000));
    expect(await db.clientDocument.count()).toBe(0);
    const purged = await db.docRequest.findUniqueOrThrow({ where: { id: first.id } });
    expect(purged).toMatchObject({ tokenEnc: null, phoneEnc: null, verifyHash: null, status: "CANCELED" });
    expect((await clientDocView(tokenOf(first.url), undefined, new Date(NOW.getTime() + 400 * 86400_000))).state).toBe("INVALID");
  });

  it("sugestão de itens pela garantia", () => {
    expect(suggestedItemKeys("Fiador")).toEqual(["doc_foto", "renda", "residencia", "fiador_doc", "fiador_renda", "fiador_matricula"]);
    expect(suggestedItemKeys("Seguro fiança")).toEqual(["doc_foto", "renda", "residencia"]);
  });
});
