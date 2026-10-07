import { execSync } from "node:child_process";
import pg from "pg";

/** Prepara o banco E2E (somente bancos com "e2e" no nome): aplica migrações, limpa dados e semeia dados sintéticos. */
export default async function setup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgresql://postgres@localhost:54329/visitas_e2e";
  if (!/e2e/.test(new URL(url).pathname)) throw new Error("Banco E2E deve conter 'e2e' no nome");
  const env = { ...process.env, DATABASE_URL: url, TOKEN_ENCRYPTION_KEY: "ZTJlLWtleS1lMmUta2V5LWUyZS1rZXktMTIzNDU2Nzg=", LOG_SILENT: "1" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'");
  await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await client.end();
  execSync("npx tsx tests/e2e/seed.ts", { env, stdio: "inherit" });
}
