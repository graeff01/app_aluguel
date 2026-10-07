/**
 * Cria usuário com senha provisória (troca obrigatória no 1º acesso).
 * Uso: TEMP_PASSWORD='...' npx tsx scripts/create-user.ts --email x@y --name "Nome" --role MANAGER|CONSULTANT|ADMIN
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { hashPassword, passwordProblem } from "../src/lib/password";
import { ensureReferenceData } from "../src/lib/settings";
import { normalizeEmail } from "../src/lib/text";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const email = normalizeEmail(arg("email") ?? "");
const name = arg("name") ?? "";
const role = (arg("role") ?? "CONSULTANT") as "ADMIN" | "MANAGER" | "CONSULTANT";
const temp = process.env.TEMP_PASSWORD ?? "";
if (!email || !name || !["ADMIN", "MANAGER", "CONSULTANT"].includes(role)) {
  console.error('Uso: TEMP_PASSWORD=... npx tsx scripts/create-user.ts --email x@y --name "Nome" --role MANAGER');
  process.exit(1);
}
const problem = passwordProblem(temp);
if (problem) {
  console.error(problem);
  process.exit(1);
}
await ensureReferenceData();
const existing = await db.user.findUnique({ where: { email } });
if (existing) {
  console.error(`Já existe usuário com ${email}. Use a tela de Usuários para definir senha provisória.`);
  process.exit(1);
}
const u = await db.user.create({ data: { email, name, role, passwordHash: await hashPassword(temp), mustChangePassword: true } });
await db.auditLog.create({ data: { actorId: null, action: "user.created_cli", entityType: "User", entityId: u.id, changes: { role } } });
console.log(`Usuário criado: ${name} <${email}> (${role}) — troca de senha obrigatória no 1º acesso.`);
await db.$disconnect();
