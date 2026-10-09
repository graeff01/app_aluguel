import type { NextRequest } from "next/server";
import { getActor } from "@/lib/session";
import { canViewDashboard } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { buildOwnerReport, isOwnerPeriod } from "@/server/owner-report";
import { renderOwnerReportPdf } from "@/server/owner-report-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PDF do imóvel para o proprietário (somente gestão). ?periodo=90|180|365|tudo */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Não autenticado", { status: 401 });
  if (!canViewDashboard(actor)) return new Response("Sem permissão", { status: 403 });
  const { code } = await ctx.params;
  const per = req.nextUrl.searchParams.get("periodo");
  const period = isOwnerPeriod(per) ? per : "90";
  try {
    const report = await buildOwnerReport(actor, decodeURIComponent(code), period);
    const pdf = await renderOwnerReportPdf(report);
    const safe = report.property.code.replace(/[^0-9A-Za-z_-]/g, "");
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${req.nextUrl.searchParams.get("ver") ? "inline" : "attachment"}; filename="imovel-${safe}-visitas.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") return new Response("Imóvel não encontrado", { status: 404 });
    throw e;
  }
}
