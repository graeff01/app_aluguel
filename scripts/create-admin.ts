/**
 * Cria (ou reativa) um administrador pelo terminal — alternativa à tela /configuracao-inicial.
 * Uso:  npm run admin:create -- --email pessoa@dominio --name "Nome"
 * A senha é pedida no terminal (não aparece) ou lida de ADMIN_PASSWORD. Nunca há senha padrão.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { db } from "../src/lib/db";
import { hashPassword, passwordProblem } from "../src/lib/password";
import { ensureReferenceData } from "../src/lib/settings";
import { normalizeEmail } from "../src/lib/text";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readHidden(prompt: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  const orig = out._writeToOutput;
  out._writeToOutput = (s: string) => (s.includes(prompt) ? orig.call(rl, s) : undefined);
  const v = await rl.question(prompt);
  rl.close();
  process.stdout.write("\n");
  return v;
}

const email = normalizeEmail(arg("email") ?? "");
const name = arg("name") ?? "";
if (!email || !name) {
  console.error('Uso: npm run admin:create -- --email pessoa@dominio --name "Nome"');
  process.exit(1);
}
const password = process.env.ADMIN_PASSWORD || (await readHidden("Senha (mín. 10 caracteres): "));
const problem = passwordProblem(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}
await ensureReferenceData();
const user = await db.user.upsert({
  where: { email },
  update: { name, role: "ADMIN", active: true, deactivatedAt: null, passwordHash: await hashPassword(password) },
  create: { email, name, role: "ADMIN", passwordHash: await hashPassword(password) },
});
await db.auditLog.create({ data: { actorId: null, action: "user.admin_cli", entityType: "User", entityId: user.id } });
console.log(`Administrador pronto: ${email}`);
await db.$disconnect();
