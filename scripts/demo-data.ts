/**
 * Dados FICTÍCIOS de demonstração para uma consultora (validação de tela), com imóveis reais do site.
 * Também disponível no app: Diagnóstico → Dados de demonstração (admin).
 * Uso: npx tsx scripts/demo-data.ts --email consultora@x [--remover]
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { createDemoData, removeDemoData } from "../src/server/demo";
import { refreshPropertyPreviews } from "../src/server/property-preview";

const i = process.argv.indexOf("--email");
const consultant = await db.user.findUniqueOrThrow({ where: { email: i >= 0 ? process.argv[i + 1] : "" } });
const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } });
if (process.argv.includes("--remover")) {
  console.log(`Removidas ${await removeDemoData(null, consultant.id)} visitas de demonstração.`);
} else {
  const n = await createDemoData({ id: admin.id, role: admin.role }, consultant.id);
  const pv = await refreshPropertyPreviews({ limit: 20, pauseMs: 400 });
  console.log(`Criadas ${n} visitas de demonstração para ${consultant.name}. Fotos atualizadas: ${pv.updated}.`);
}
await db.$disconnect();
