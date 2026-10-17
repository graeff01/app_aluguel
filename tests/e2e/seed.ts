// Dados sintéticos para E2E. Horários relativos a "agora" em São Paulo.
import { db } from "../../src/lib/db";
import { hashPassword } from "../../src/lib/password";
import { ensureReferenceData } from "../../src/lib/settings";
import { toLocalInput } from "../../src/lib/time";
import { concludeVisit, createManualVisit } from "../../src/server/visits";

export const PW = "senha-e2e-segura-1";

await ensureReferenceData();
await db.appSettings.update({ where: { id: 1 }, data: { resultsStartDate: new Date("2020-01-01T00:00:00Z") } });
const hash = await hashPassword(PW);
await db.user.create({ data: { name: "Gestora E2E", email: "gestora@e2e.test", role: "MANAGER", passwordHash: hash } });
const a = await db.user.create({ data: { name: "Consultora A", email: "a@e2e.test", role: "CONSULTANT", passwordHash: hash } });
const b = await db.user.create({ data: { name: "Consultora B", email: "b@e2e.test", role: "CONSULTANT", passwordHash: hash } });
await db.user.create({ data: { name: "Nova Gestora", email: "nova@e2e.test", role: "MANAGER", passwordHash: await hashPassword("provisoria-123"), mustChangePassword: true } });
const admin = await db.user.create({ data: { name: "Admin E2E", email: "admin@e2e.test", role: "ADMIN", passwordHash: hash } });

const c = await db.user.create({ data: { name: "Consultora C", email: "c@e2e.test", role: "CONSULTANT", passwordHash: hash } });
await db.user.create({ data: { name: "Pessoa Nova", email: "privacidade@e2e.test", role: "CONSULTANT", passwordHash: hash } });
// demais usuários de teste já deram ciência do aviso de privacidade
await db.user.updateMany({ where: { email: { not: "privacidade@e2e.test" } }, data: { privacyAcceptedAt: new Date() } });
await db.user.create({ data: { name: "Jasmin Pré", email: "jasmin@e2e.test", role: "PRE_SERVICE", passwordHash: hash, privacyAcceptedAt: new Date() } });
await db.user.create({ data: { name: "Gisele Nova", email: "guia@e2e.test", role: "CONSULTANT", passwordHash: hash, privacyAcceptedAt: new Date() } });
await db.user.create({ data: { name: "Marketing E2E", email: "mkt@e2e.test", role: "MARKETING", passwordHash: hash, privacyAcceptedAt: new Date() } });
// todos já passaram pelo guia de primeiro acesso, exceto a usuária do teste do guia
await db.user.updateMany({ where: { email: { not: "guia@e2e.test" } }, data: { onboardedAt: new Date() } });
const ago = (h: number) => toLocalInput(new Date(Date.now() - h * 3600_000));
await createManualVisit(admin, { requestId: "e2e-seed-a1", scheduledStart: ago(3), clientName: "Cliente Alfa", phoneRaw: "(51) 99876-0001", propertyCode: "00777", consultantId: a.id });
await createManualVisit(admin, { requestId: "e2e-seed-a2", scheduledStart: ago(30), clientName: "Cliente Beta", phoneRaw: "", propertyCode: "00888", consultantId: a.id });
await createManualVisit(admin, { requestId: "e2e-seed-a3", scheduledStart: ago(2), clientName: "Cliente Offline", phoneRaw: "(51) 99876-0003", propertyCode: "00999", consultantId: a.id });
await createManualVisit(admin, { requestId: "e2e-seed-b1", scheduledStart: ago(3), clientName: "Cliente Da B", phoneRaw: "(51) 99876-0002", propertyCode: "00555", consultantId: b.id });
const inHours = (h: number) => toLocalInput(new Date(Date.now() + h * 3600_000));
await createManualVisit(admin, { requestId: "e2e-seed-futuro", scheduledStart: inHours(5), clientName: "Cliente Futuro", phoneRaw: "", propertyCode: "00321", consultantId: a.id });
await createManualVisit(admin, { requestId: "e2e-seed-rota", scheduledStart: inHours(3), clientName: "Cliente Rota", phoneRaw: "(51) 99876-0322", propertyCode: "00322", consultantId: c.id });
await db.property.update({ where: { code: "00322" }, data: { address: "Rua Teste, 322", addressSource: "MANUAL", neighborhood: "Centro", city: "Canoas", category: "Apartamento", rent: 1800, condoFee: 420, iptu: 90, totalPrice: 2310, area: 64, bedrooms: 2, lat: -29.9177, lng: -51.1837, geoQuery: "Rua Teste, 322, Canoas - RS", geoPrecision: "ADDRESS", geocodedAt: new Date() } });
await createManualVisit(admin, { requestId: "e2e-seed-atalho", scheduledStart: ago(4), clientName: "Cliente Atalho", phoneRaw: "", propertyCode: "00556", consultantId: c.id });
await db.property.update({ where: { code: "00556" }, data: { neighborhood: "Igara", city: "Canoas", lat: -29.903, lng: -51.164, geoQuery: "Igara, Canoas - RS", geoPrecision: "AREA", geocodedAt: new Date() } });
const kb = await createManualVisit(admin, { requestId: "e2e-seed-kanban", scheduledStart: ago(120), clientName: "Cliente Kanban", phoneRaw: "(51) 99876-0444", propertyCode: "00444", consultantId: b.id });
await concludeVisit(admin, kb.id, { requestId: "e2e-seed-kanban-done", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "Gostou e vai trazer a família." });
await db.$disconnect();

// visita daqui a pouco para o pré-atendimento cancelar
await createManualVisit(admin, { requestId: "e2e-seed-cancel", scheduledStart: toLocalInput(new Date(Date.now() + 20 * 60_000)), clientName: "Cliente Cancela", phoneRaw: "(51) 99876-0099", propertyCode: "00555", consultantId: b.id });

// ── jornadas diárias (tests/e2e/jornadas.spec.ts): dados próprios, para não cruzar com os outros testes ──
{
  const { dayKey, addDays } = await import("../../src/lib/time");
  const tomorrow10 = new Date(`${addDays(dayKey(new Date()), 1)}T13:00:00Z`); // amanhã 10:00 em Brasília
  // visita de amanhã com 3 imóveis (B): Jasmin cancela só um
  const multi = await createManualVisit(admin, { requestId: "e2e-jornada-multi", scheduledStart: toLocalInput(tomorrow10), clientName: "Cliente Multi", phoneRaw: "(51) 99876-0701", propertyCode: "00701", consultantId: b.id });
  for (const code of ["00702", "00703"]) {
    await db.visit.create({ data: { origin: "MANUAL", companionOfId: multi.id, scheduledStart: multi.scheduledStart, scheduledEnd: multi.scheduledEnd, clientName: "Cliente Multi", phoneRaw: "(51) 99876-0701", phoneNormalized: "+5551998760701", propertyCode: code, consultantId: b.id, assignmentStatus: "MANUAL" } });
  }
  // visita que já passou com 2 imóveis (A): cliente não veio → vale para os dois
  const grupo = await createManualVisit(admin, { requestId: "e2e-jornada-grupo", scheduledStart: ago(5), clientName: "Cliente Grupo", phoneRaw: "(51) 99876-0801", propertyCode: "00801", consultantId: a.id });
  await db.visit.create({ data: { origin: "MANUAL", companionOfId: grupo.id, scheduledStart: grupo.scheduledStart, scheduledEnd: grupo.scheduledEnd, clientName: "Cliente Grupo", phoneRaw: "(51) 99876-0801", phoneNormalized: "+5551998760801", propertyCode: "00802", consultantId: a.id, assignmentStatus: "MANUAL" } });
  // locação para a gestora fechar e o marketing postar
  const fecha = await createManualVisit(admin, { requestId: "e2e-jornada-fecha", scheduledStart: ago(48), clientName: "Cliente Fecha", phoneRaw: "(51) 99876-0901", propertyCode: "00901", consultantId: b.id });
  await concludeVisit(admin, fecha.id, { requestId: "e2e-jornada-fecha-done", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "Gostou, vai mandar os documentos." });
  // negócio da Consultora A: ela muda a etapa pelo celular
  const cel = await createManualVisit(admin, { requestId: "e2e-jornada-celular", scheduledStart: ago(30), clientName: "Cliente Celular", phoneRaw: "(51) 99876-0902", propertyCode: "00902", consultantId: a.id });
  await concludeVisit(admin, cel.id, { requestId: "e2e-jornada-celular-done", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "Quer fazer proposta." });
  await db.$disconnect();
}
