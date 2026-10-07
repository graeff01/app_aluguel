/**
 * Dados FICTÍCIOS de demonstração para uma consultora (validação de tela).
 * Clientes com prefixo "[DEMO]"; chaves "demo-…". Remover tudo: --remover
 * Uso: npx tsx scripts/demo-data.ts --email consultora@x [--remover]
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { getSettings } from "../src/lib/settings";
import { concludeVisit, createManualVisit } from "../src/server/visits";
import { refreshPropertyPreviews } from "../src/server/property-preview";
import { toLocalInput } from "../src/lib/time";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const email = arg("email");
const consultant = await db.user.findUniqueOrThrow({ where: { email: email ?? "" } });
const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } });
const actor = { id: admin.id, role: admin.role };

if (process.argv.includes("--remover")) {
  const visits = await db.visit.findMany({ where: { consultantId: consultant.id, clientName: { startsWith: "[DEMO]" } }, select: { id: true, clientId: true, opportunityId: true } });
  const ids = visits.map((v) => v.id);
  const opps = [...new Set(visits.map((v) => v.opportunityId).filter(Boolean))] as string[];
  const clients = [...new Set(visits.map((v) => v.clientId).filter(Boolean))] as string[];
  await db.$transaction(async (tx) => {
    await tx.visit.updateMany({ where: { id: { in: ids } }, data: { opportunityId: null } });
    await tx.opportunity.deleteMany({ where: { id: { in: opps } } });
    await tx.visitOutcomeHistory.deleteMany({ where: { visitId: { in: ids } } });
    await tx.visit.deleteMany({ where: { id: { in: ids } } });
    await tx.client.deleteMany({ where: { id: { in: clients }, visits: { none: {} } } });
    await tx.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  });
  console.log(`Removidas ${ids.length} visitas de demonstração.`);
  process.exit(0);
}

const settings = await getSettings();
const now = Date.now();
const H = 3600_000;
const at = (hoursFromNow: number) => {
  // arredonda para hora cheia e respeita a data de início da cobrança
  const d = new Date(Math.round((now + hoursFromNow * H) / H) * H);
  return d < settings.resultsStartDate ? new Date(settings.resultsStartDate.getTime() + 12 * H) : d;
};
type Plan = { h: number; name: string; code: string; result?: "POSITIVE" | "NEGATIVE" | "UNDECIDED" | "NO_SHOW"; note?: string };
const plan: Plan[] = [
  { h: -26, name: "[DEMO] Mariana Alves", code: "761739" },
  { h: -25, name: "[DEMO] Ricardo Nunes", code: "767207" },
  { h: -3, name: "[DEMO] Paula Ramos", code: "740146" },
  { h: 3, name: "[DEMO] Bruno Teixeira", code: "775040" },
  { h: 24, name: "[DEMO] Camila Duarte", code: "734999" },
  { h: -20, name: "[DEMO] Felipe Moraes", code: "722136", result: "POSITIVE", note: "Gostou muito da cozinha e da localização. Vai enviar a documentação." },
  { h: -22, name: "[DEMO] Juliana Pires", code: "684923", result: "NEGATIVE", note: "Achou o condomínio alto para o orçamento." },
  { h: -4, name: "[DEMO] André Lima", code: "731602", result: "UNDECIDED", note: "Vai conversar com a família e dar retorno até sexta." },
  { h: -6, name: "[DEMO] Sofia Martins", code: "761128", result: "NO_SHOW", note: "Não compareceu e não atendeu o telefone." },
];
const negReason = await db.reason.findFirst({ where: { kind: "VISIT_NEGATIVE", label: { startsWith: "Preço" } } });
let n = 0;
for (const p of plan) {
  const v = await createManualVisit(actor, {
    requestId: `demo-${consultant.id}-${p.code}-${p.h}`,
    scheduledStart: toLocalInput(at(p.h)),
    durationMinutes: 60,
    clientName: p.name,
    phoneRaw: "",
    propertyCode: p.code,
    consultantId: consultant.id,
  });
  if (p.result && v.status === "SCHEDULED") {
    await concludeVisit(actor, v.id, {
      requestId: `demo-done-${v.id}`,
      expectedVersion: v.version,
      status: p.result === "NO_SHOW" ? "NO_SHOW" : "DONE",
      evaluation: p.result === "NO_SHOW" ? null : p.result,
      negativeReasonId: p.result === "NEGATIVE" ? negReason?.id ?? null : null,
      note: p.note ?? "Demonstração.",
    });
    // registradas pela própria consultora (aparece como autora)
    await db.visit.update({ where: { id: v.id }, data: { concludedById: consultant.id } });
    await db.visitOutcomeHistory.updateMany({ where: { visitId: v.id }, data: { authorId: consultant.id } });
  }
  n++;
}
const pv = await refreshPropertyPreviews({ limit: 20, pauseMs: 400 });
console.log(`Criadas ${n} visitas de demonstração para ${consultant.name}. Fotos atualizadas: ${pv.updated}.`);
await db.$disconnect();
