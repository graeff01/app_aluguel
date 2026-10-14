import type { NextRequest } from "next/server";
import { recordError } from "@/lib/error-tracking";
import { hitRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Relatórios da política de conteúdo (CSP em modo "só observar"): o que seria bloqueado vira um registro no Diagnóstico.
 * Agrupados por diretiva + origem bloqueada (sem URLs completas, sem dados pessoais).
 */
export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
  if (!(await hitRateLimit(`csp:${ip}`, 60, 600)).allowed) return new Response(null, { status: 204 });
  const body = await req.json().catch(() => null);
  const reports: Record<string, unknown>[] = Array.isArray(body) ? body.map((b) => b?.body ?? b) : body?.["csp-report"] ? [body["csp-report"]] : body ? [body] : [];
  for (const r of reports.slice(0, 10)) {
    const directive = String(r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"] ?? "?").slice(0, 40);
    const blocked = String(r["blocked-uri"] ?? r.blockedURL ?? "?");
    let origin = blocked;
    try {
      origin = new URL(blocked).origin;
    } catch {}
    const page = String(r["document-uri"] ?? r.documentURL ?? "");
    let path: string | null = null;
    try {
      path = new URL(page).pathname;
    } catch {}
    await recordError({ source: "client", message: `CSP (observação): ${directive} bloquearia ${origin.slice(0, 80)}`, path });
  }
  return new Response(null, { status: 204 });
}
