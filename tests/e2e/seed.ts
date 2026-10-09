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

await db.user.create({ data: { name: "Pessoa Nova", email: "privacidade@e2e.test", role: "CONSULTANT", passwordHash: hash } });
// demais usuários de teste já deram ciência do aviso de privacidade
await db.user.updateMany({ where: { email: { not: "privacidade@e2e.test" } }, data: { privacyAcceptedAt: new Date() } });
const ago = (h: number) => toLocalInput(new Date(Date.now() - h * 3600_000));
await createManualVisit(admin, { requestId: "e2e-seed-a1", scheduledStart: ago(3), clientName: "Cliente Alfa", phoneRaw: "(51) 99876-0001", propertyCode: "00777", consultantId: a.id });
await createManualVisit(admin, { requestId: "e2e-seed-a2", scheduledStart: ago(30), clientName: "Cliente Beta", phoneRaw: "", propertyCode: "00888", consultantId: a.id });
await createManualVisit(admin, { requestId: "e2e-seed-a3", scheduledStart: ago(2), clientName: "Cliente Offline", phoneRaw: "(51) 99876-0003", propertyCode: "00999", consultantId: a.id });
await createManualVisit(admin, { requestId: "e2e-seed-b1", scheduledStart: ago(3), clientName: "Cliente Da B", phoneRaw: "(51) 99876-0002", propertyCode: "00555", consultantId: b.id });
const inHours = (h: number) => toLocalInput(new Date(Date.now() + h * 3600_000));
await createManualVisit(admin, { requestId: "e2e-seed-futuro", scheduledStart: inHours(5), clientName: "Cliente Futuro", phoneRaw: "", propertyCode: "00321", consultantId: a.id });
const kb = await createManualVisit(admin, { requestId: "e2e-seed-kanban", scheduledStart: ago(120), clientName: "Cliente Kanban", phoneRaw: "(51) 99876-0444", propertyCode: "00444", consultantId: b.id });
await concludeVisit(admin, kb.id, { requestId: "e2e-seed-kanban-done", expectedVersion: 1, status: "DONE", evaluation: "POSITIVE", note: "Gostou e vai trazer a família." });
await db.$disconnect();
