import { db } from "./db";

/** Janela fixa persistida no Postgres (funciona com várias instâncias). */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number) {
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" < now() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" < now() THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING "count", "resetAt"`;
  const { count, resetAt } = rows[0];
  return { allowed: count <= limit, count, retryAfterSeconds: Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / 1000)) };
}

export async function clearRateLimit(key: string) {
  await db.rateLimit.deleteMany({ where: { key } });
}
