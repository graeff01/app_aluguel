/**
 * Dados SINTÉTICOS para desenvolvimento/teste. Recusa rodar em produção.
 * Cria: admin, gestora, 2 consultoras (e-mails .test), visitas variadas e uma oportunidade.
 * Senha de todos: definida por SEED_PASSWORD (obrigatória).
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";
import { ensureReferenceData } from "../src/lib/settings";
import { createManualVisit, concludeVisit } from "../src/server/visits";
import { dayKey, addDays } from "../src/lib/time";

if (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
  console.error("Seed de demonstração não roda em produção.");
  process.exit(1);
}
const pw = process.env.SEED_PASSWORD;
if (!pw || pw.length < 10) {
  console.error("Defina SEED_PASSWORD (mín. 10 caracteres) para o seed de desenvolvimento.");
  process.exit(1);
}
if ((await db.user.count()) > 0) {
  console.error("Banco já tem usuários; seed abortado para não misturar dados.");
  process.exit(1);
}
await ensureReferenceData();
const hash = await hashPassword(pw);
const admin = await db.user.create({ data: { name: "Admin Demo", email: "admin@demo.test", role: "ADMIN", passwordHash: hash } });
await db.user.create({ data: { name: "Gestora Demo", email: "gestora@demo.test", role: "MANAGER", passwordHash: hash } });
const a = await db.user.create({ data: { name: "Consultora A (demo)", email: "consultora.a@demo.test", role: "CONSULTANT", passwordHash: hash, aliases: { create: { email: "consultora.a@agenda.test" } } } });
const b = await db.user.create({ data: { name: "Consultora B (demo)", email: "consultora.b@demo.test", role: "CONSULTANT", passwordHash: hash, aliases: { create: { email: "consultora.b@agenda.test" } } } });
await db.appSettings.update({ where: { id: 1 }, data: { resultsStartDate: new Date(addDays(dayKey(new Date()), -20) + "T00:00:00Z") } });

const today = dayKey(new Date());
const names = ["Cliente Teste Um", "Cliente Teste Dois", "Cliente Teste Três", "Cliente Teste Quatro", "Cliente Teste Cinco"];
const reasons = await db.reason.findMany({ where: { kind: "VISIT_NEGATIVE" } });
let i = 0;
for (let d = -10; d <= 2; d++) {
  for (const who of [a, b]) {
    const v = await createManualVisit(admin, {
      requestId: `seed-${d}-${who.id}`,
      scheduledStart: `${addDays(today, d)}T${String(9 + (i % 8)).padStart(2, "0")}:00`,
      clientName: names[i % names.length],
      phoneRaw: i % 4 === 3 ? "" : `(51) 99${String(100000 + i).slice(-3)}-${String(1000 + i).slice(-4)}`,
      propertyCode: String(1000 + (i % 6)).padStart(5, "0"),
      consultantId: who.id,
    });
    if (d < -1 && i % 5 !== 0) {
      const kind = i % 7;
      await concludeVisit(admin, v.id, {
        requestId: `seed-c-${v.id}`,
        expectedVersion: v.version,
        status: kind === 0 ? "NO_SHOW" : kind === 1 ? "CANCELED" : "DONE",
        evaluation: kind <= 1 ? null : kind % 3 === 0 ? "NEGATIVE" : kind % 3 === 1 ? "POSITIVE" : "UNDECIDED",
        negativeReasonId: kind > 1 && kind % 3 === 0 ? reasons[i % reasons.length].id : null,
        note: "Observação sintética de demonstração.",
      });
    }
    i++;
  }
}
console.log("Seed de desenvolvimento criado. Logins: admin@demo.test, gestora@demo.test, consultora.a@demo.test, consultora.b@demo.test");
await db.$disconnect();
