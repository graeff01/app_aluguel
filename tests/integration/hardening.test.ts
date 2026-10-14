// Pacote de segurança: exportação de dados do titular (LGPD), encerrar acessos, relatório da política de conteúdo.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { exportClientData } from "@/server/privacy";
import { createPreAnalysis } from "@/server/pre-analysis";
import { createManualVisit } from "@/server/visits";
import { POST as cspReport } from "@/app/api/csp-report/route";
import { toLocalInput } from "@/lib/time";
import { makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
const NOW = new Date("2026-10-14T15:00:00Z");

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

describe("exportação dos dados do titular", () => {
  it("traz visitas, observações e pré-análises ligadas pelo telefone; só gestão; fica na auditoria", async () => {
    const j = await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@exemplo.test", role: "PRE_SERVICE" } });
    await createPreAnalysis({ id: j.id, role: "PRE_SERVICE" }, { fullName: "Maria Titular da Silva", birthDate: "1990-05-20", cpf: "529.982.247-25", email: "maria@exemplo.test", phone: "(51) 99876-1234", salary: "4.500,00", consultantId: u.a.id, propertyCode: "", note: "", holderConfirmed: true }, NOW);
    const v = await createManualVisit(u.admin, { requestId: "exp-visit-req", scheduledStart: toLocalInput(NOW), clientName: "Maria Titular", phoneRaw: "(51) 99876-1234", propertyCode: "761739", consultantId: u.a.id });
    await expect(exportClientData(u.a, v.clientId!)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const data = await exportClientData(u.manager, v.clientId!);
    expect(data.titular.telefones).toEqual(["(51) 99876-1234"]);
    expect(data.visitas).toHaveLength(1);
    expect(data.preAnalises[0]).toMatchObject({ cpf: "52998224725", email: "maria@exemplo.test", nascimento: "1990-05-20" });
    expect(await db.auditLog.count({ where: { action: "client.data_exported" } })).toBe(1);
  });
});

describe("política de conteúdo (observação)", () => {
  it("relatório vira um registro agrupado no Diagnóstico, sem URL completa", async () => {
    const req = (body: unknown) => new Request("http://localhost/api/csp-report", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/csp-report", "x-forwarded-for": "10.0.0.1" } });
    const body = { "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://cdn.exemplo.test/foto.jpg?token=segredo", "document-uri": "https://app.test/minhas?busca=Maria" } };
    expect((await cspReport(req(body) as never)).status).toBe(204);
    await cspReport(req(body) as never);
    const e = await db.errorEvent.findFirstOrThrow();
    expect(e.message).toBe("CSP (observação): img-src bloquearia https://cdn.exemplo.test");
    expect(e.count).toBe(2);
    expect(JSON.stringify(e)).not.toMatch(/segredo|Maria/);
  });
});
