import type { NextRequest } from "next/server";
import { getActor } from "@/lib/session";
import { canViewDashboard } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dayKey } from "@/lib/time";
import { buildMonthlyReport, isMonth } from "@/server/report";
import { renderMonthlyReportPdf } from "@/server/report-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF do relatório mensal (somente gestão). ?mes=YYYY-MM */
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Não autenticado", { status: 401 });
  if (!canViewDashboard(actor)) return new Response("Sem permissão", { status: 403 });
  const mes = req.nextUrl.searchParams.get("mes");
  const month = isMonth(mes) ? mes : dayKey(new Date()).slice(0, 7);
  const report = await buildMonthlyReport(actor, month);
  const pdf = await renderMonthlyReportPdf(report);
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "report.monthly_pdf", entityType: "Report", entityId: month }));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${req.nextUrl.searchParams.get("ver") ? "inline" : "attachment"}; filename="relatorio-visitas-${month}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
