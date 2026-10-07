import { db } from "@/lib/db";
import { ensureReferenceData } from "@/lib/settings";
import { encryptSecret } from "@/lib/crypto";

export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await ensureReferenceData();
  await db.appSettings.update({ where: { id: 1 }, data: { resultsStartDate: new Date("2026-01-01T00:00:00Z") } });
}

export async function makeUsers() {
  const admin = await db.user.create({ data: { name: "Admin Teste", email: "admin@exemplo.test", role: "ADMIN" } });
  const manager = await db.user.create({ data: { name: "Gestora Teste", email: "gestora@exemplo.test", role: "MANAGER" } });
  const a = await db.user.create({
    data: { name: "Consultora A", email: "a@exemplo.test", role: "CONSULTANT", aliases: { create: [{ email: "consultora.a@exemplo.test" }] } },
  });
  const b = await db.user.create({
    data: { name: "Consultora B", email: "b@exemplo.test", role: "CONSULTANT", aliases: { create: [{ email: "consultora.b@exemplo.test" }] } },
  });
  return { admin, manager, a, b };
}

export async function makeConnection(calendarId = "central@exemplo.test", accessRole = "reader") {
  return db.googleConnection.create({
    data: {
      googleEmail: "agenda.central@exemplo.test",
      googleSub: "sub-123",
      refreshTokenEnc: encryptSecret("refresh-token-sintetico"),
      scopes: "calendar.events.readonly",
      calendarId,
      calendarSummary: "Agenda central",
      calendarAccessRole: accessRole,
    },
  });
}

export const reason = (label: string, kind: "VISIT_NEGATIVE" | "OPPORTUNITY_LOST" = "VISIT_NEGATIVE") =>
  db.reason.findFirstOrThrow({ where: { label, kind } });
