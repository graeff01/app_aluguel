import { execSync } from "node:child_process";

/** Aplica migrações no banco de teste (dados sintéticos apenas). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:54329/visitas_test";
  if (!/test/.test(url)) throw new Error("Recusando rodar testes fora de um banco *_test");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
