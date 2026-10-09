/**
 * Dados FICTÍCIOS de demonstração (validação de tela) com imóveis REAIS do site (fotos e bairros de verdade).
 * Marca: chave de cadastro "demo-…" (nomes ficam realistas). Registros antigos com prefixo "[DEMO]" também contam.
 * Visitas de demonstração NÃO geram notificações e ficam fora do termômetro, do PDF do proprietário e do relatório mensal.
 * Criação e remoção pelo admin (Diagnóstico) — sem acesso direto ao banco.
 */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assert, isAdmin, type AuthzActor } from "@/lib/authz";
import { dateOnlyKey, startOfDayInTz, toLocalInput } from "@/lib/time";
import { getSettings } from "@/lib/settings";
import { concludeVisit, createManualVisit } from "./visits";

export const DEMO_PREFIX = "[DEMO]";
export const DEMO_KEY = "demo-";
const demoWhere: Prisma.VisitWhereInput = { OR: [{ clientName: { startsWith: DEMO_PREFIX } }, { createRequestId: { startsWith: DEMO_KEY } }] };

/** Filtro "não é demonstração" (cuidado com nulos: NOT sozinho descartaria visitas sem nome/sem chave). */
export const notDemo: Prisma.VisitWhereInput = {
  AND: [
    { OR: [{ clientName: null }, { NOT: { clientName: { startsWith: DEMO_PREFIX } } }] },
    { OR: [{ createRequestId: null }, { NOT: { createRequestId: { startsWith: DEMO_KEY } } }] },
  ],
};

export function countDemoVisits() {
  return db.visit.count({ where: demoWhere });
}

type Slot = { min: number; name: string; code: string; result?: "POSITIVE" | "NEGATIVE" | "UNDECIDED" | "NO_SHOW"; note?: string; duration?: number };
// minutos em relação a agora (arredondado para meia hora): ontem, hoje (feitas, pendentes, em andamento, próximas) e amanhã
const PLAN: Slot[] = [
  { min: -30 * 60, name: "Mariana Alves", code: "761739" },
  { min: -27 * 60, name: "André Lima", code: "731602", result: "UNDECIDED", note: "Gostou do espaço, vai conversar com a família e dar retorno até segunda." },
  { min: -390, name: "Felipe Moraes", code: "722136", result: "POSITIVE", note: "Gostou muito da cozinha e da localização. Vai enviar a documentação hoje." },
  { min: -300, name: "Juliana Pires", code: "684923", result: "NEGATIVE", note: "Achou o valor total alto para o orçamento." },
  { min: -150, name: "Paula Ramos", code: "740146" },
  { min: -20, name: "Rafael Costa", code: "391695" },
  { min: 90, name: "Bruno Teixeira", code: "767207" },
  { min: 180, name: "Camila Duarte", code: "775040" },
  { min: 20 * 60, name: "Larissa Souza", code: "734999" },
  { min: 23 * 60, name: "Sofia Martins", code: "761128", duration: 45 },
];

export async function createDemoData(actor: AuthzActor, consultantId: string, now = new Date()) {
  assert(isAdmin(actor));
  const consultant = await db.user.findUnique({ where: { id: consultantId } });
  if (!consultant || consultant.role !== "CONSULTANT" || !consultant.active) throw new AppError("VALIDATION", "Escolha uma consultora ativa.");
  if (await db.visit.count({ where: { ...demoWhere, consultantId } })) throw new AppError("INVALID_STATE", `${consultant.name.split(" ")[0]} já tem visitas de demonstração. Remova antes de criar de novo.`);
  const chargeStart = startOfDayInTz(dateOnlyKey((await getSettings()).resultsStartDate));
  const base = Math.floor(now.getTime() / 1_800_000) * 1_800_000;
  const negReason = await db.reason.findFirst({ where: { kind: "VISIT_NEGATIVE", label: { startsWith: "Preço" } } });
  const stamp = now.getTime().toString(36);
  let n = 0;
  for (const [i, p] of PLAN.entries()) {
    const start = new Date(base + p.min * 60_000);
    if (start < chargeStart) continue; // antes do início da cobrança não apareceria como pendente
    const v = await createManualVisit(actor, {
      requestId: `${DEMO_KEY}${stamp}-${i}-${consultantId}`.slice(0, 100),
      scheduledStart: toLocalInput(start),
      durationMinutes: p.duration ?? 60,
      clientName: p.name,
      phoneRaw: "",
      propertyCode: p.code,
      consultantId,
    });
    if (p.result && v.status === "SCHEDULED") {
      await concludeVisit(actor, v.id, {
        requestId: `${DEMO_KEY}done-${v.id}`,
        expectedVersion: v.version,
        status: p.result === "NO_SHOW" ? "NO_SHOW" : "DONE",
        evaluation: p.result === "NO_SHOW" ? null : p.result,
        negativeReasonId: p.result === "NEGATIVE" ? (negReason?.id ?? null) : null,
        note: p.note ?? "Demonstração.",
      }, now);
      // registrada pela própria consultora (aparece como autora)
      await db.visit.update({ where: { id: v.id }, data: { concludedById: consultantId } });
      await db.visitOutcomeHistory.updateMany({ where: { visitId: v.id }, data: { authorId: consultantId } });
    }
    n++;
  }
  // fotos, bairros e coordenadas: o worker completa em poucos minutos
  await db.property.updateMany({ where: { code: { in: PLAN.map((p) => p.code) }, pageStatus: null }, data: { pageCheckedAt: null } });
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "demo.created", entityType: "User", entityId: consultantId, changes: { visitas: n } }));
  return n;
}

/** Remove visitas de demonstração com histórico, oportunidades e clientes que ficarem sem visitas. */
export async function removeDemoData(actor: AuthzActor | null, consultantId?: string) {
  if (actor) assert(isAdmin(actor));
  const visits = await db.visit.findMany({ where: { ...demoWhere, ...(consultantId ? { consultantId } : {}) }, select: { id: true, clientId: true, opportunityId: true } });
  const ids = visits.map((v) => v.id);
  const opps = [...new Set(visits.map((v) => v.opportunityId).filter(Boolean))] as string[];
  const clients = [...new Set(visits.map((v) => v.clientId).filter(Boolean))] as string[];
  await db.$transaction(async (tx) => {
    await tx.visit.updateMany({ where: { id: { in: ids } }, data: { opportunityId: null } });
    await tx.opportunityEvent.deleteMany({ where: { opportunityId: { in: opps } } });
    await tx.opportunity.deleteMany({ where: { id: { in: opps }, visits: { none: {} } } });
    await tx.visitOutcomeHistory.deleteMany({ where: { visitId: { in: ids } } });
    await tx.reminderLog.deleteMany({ where: { kind: { in: ids.flatMap((id) => [`upcoming:${id}`, `result_prompt:${id}`, `result_reminder:${id}`, `manager_late:${id}`]) } } });
    await tx.visit.deleteMany({ where: { id: { in: ids } } });
    await tx.clientPhone.deleteMany({ where: { clientId: { in: clients }, client: { visits: { none: {} }, opportunities: { none: {} } } } });
    await tx.client.deleteMany({ where: { id: { in: clients }, visits: { none: {} }, opportunities: { none: {} } } });
    await tx.auditLog.deleteMany({ where: { entityType: "Visit", entityId: { in: ids } } });
    if (ids.length) await audit(tx, { actorId: actor?.id ?? null, action: "demo.removed", entityType: "Visit", entityId: "-", changes: { visitas: ids.length } });
  });
  return ids.length;
}
