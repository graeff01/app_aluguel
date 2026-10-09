/**
 * Prévia do relatório mensal com dados SINTÉTICOS (somente desenvolvimento).
 * Uso: DATABASE_URL=<banco local *_preview> npx tsx scripts/report-preview.ts 2026-09 saida.pdf
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { ensureReferenceData } from "../src/lib/settings";
import { concludeVisit, createManualVisit } from "../src/server/visits";
import { updateOpportunity } from "../src/server/opportunities";
import { buildMonthlyReport } from "../src/server/report";
import { renderMonthlyReportPdf } from "../src/server/report-pdf";

if (!/preview/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Use um banco com 'preview' no nome.");
  process.exit(1);
}
const [month = "2026-09", out = "relatorio-preview.pdf"] = process.argv.slice(2);
await ensureReferenceData();
await db.appSettings.update({ where: { id: 1 }, data: { resultsStartDate: new Date("2026-01-01T00:00:00Z") } });
if ((await db.user.count()) === 0) {
  const admin = await db.user.create({ data: { name: "Admin", email: "admin@preview.test", role: "ADMIN" } });
  const people = await Promise.all(
    ["Eduarda Schuler", "Ramires Costa", "Tamires Lima"].map((name, i) => db.user.create({ data: { name, email: `c${i}@preview.test`, role: "CONSULTANT" } })),
  );
  const neg = await db.reason.findMany({ where: { kind: "VISIT_NEGATIVE" } });
  const lost = await db.reason.findMany({ where: { kind: "OPPORTUNITY_LOST" } });
  const codes = ["761739", "767207", "740146", "775040", "734999", "722136", "684923", "731602", "761128", "391695"];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  let n = 0;
  for (let mo = 4; mo <= 9; mo++) {
    for (const [pi, p] of people.entries()) {
      const qty = 10 + Math.floor(rnd() * 8) + (mo - 4) * 2 + pi * 2;
      for (let k = 0; k < qty; k++) {
        const day = 1 + Math.floor(rnd() * 27);
        const hour = 9 + Math.floor(rnd() * 9);
        const v = await createManualVisit(admin, {
          requestId: `prev-${mo}-${pi}-${k}-${++n}`,
          scheduledStart: `2026-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00`,
          clientName: `Cliente ${n}`,
          phoneRaw: rnd() > 0.2 ? `(51) 99${String(100000 + n).slice(-3)}-${String(1000 + n).slice(-4)}` : "",
          propertyCode: codes[Math.floor(rnd() * codes.length)],
          consultantId: p.id,
        });
        const r = rnd();
        if (r < 0.06) continue; // sem registro
        const status = r < 0.13 ? "NO_SHOW" : r < 0.18 ? "CANCELED" : r < 0.21 ? "RESCHEDULED" : "DONE";
        const ev = status !== "DONE" ? null : rnd() < 0.3 + pi * 0.06 ? "POSITIVE" : rnd() < 0.55 ? "NEGATIVE" : "UNDECIDED";
        await concludeVisit(admin, v.id, { requestId: `prev-c-${n}`, expectedVersion: v.version, status, evaluation: ev, negativeReasonId: ev === "NEGATIVE" ? neg[Math.floor(rnd() * neg.length)].id : null, note: "Observação sintética." }, new Date("2026-10-08T12:00:00Z"));
      }
    }
  }
  const opps = await db.opportunity.findMany({ where: { status: "FOLLOW_UP" } });
  for (const o of opps) {
    const r = rnd();
    if (r < 0.45) {
      await updateOpportunity(admin, o.id, { expectedVersion: o.version, toStatus: "DOCS_REVIEW" });
      if (r < 0.28) {
        const cur = await db.opportunity.findUniqueOrThrow({ where: { id: o.id } });
        const d = new Date(o.firstDoneVisitAt.getTime() + (5 + Math.floor(rnd() * 15)) * 86400_000);
        const key = d.toISOString().slice(0, 10) > "2026-10-08" ? "2026-10-08" : d.toISOString().slice(0, 10);
        await updateOpportunity(admin, o.id, { expectedVersion: cur.version, toStatus: "CLOSED_WON", closedAt: key });
      }
    } else if (r < 0.6) {
      await updateOpportunity(admin, o.id, { expectedVersion: o.version, toStatus: "LOST", lostReasonId: lost[Math.floor(rnd() * lost.length)].id, note: "Desistiu." });
    }
  }
  for (const [i, code] of codes.entries()) await db.property.update({ where: { code }, data: { title: `Apartamento com ${2 + (i % 2)} quartos para alugar em ${["Centro", "Marechal Rondon", "Nossa Senhora das Graças", "Igara", "São José"][i % 5]}, Canoas.` } });
}
const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
const report = await buildMonthlyReport({ id: admin.id, role: "ADMIN" }, month, new Date("2026-10-08T15:00:00Z"));
writeFileSync(out, await renderMonthlyReportPdf(report));
console.log(`PDF gerado: ${out} (${report.perConsultant.length} consultoras, ${report.team.done} realizadas)`);
await db.$disconnect();
