import type { NextRequest } from "next/server";
import { getActor } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { readPreAnalysisFile } from "@/server/pre-analysis-files";

export const dynamic = "force-dynamic";

/** Abre um documento da pré-análise (decifrado na hora; quem pode ver a pré-análise; registrado na auditoria). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Não autenticado", { status: 401 });
  const { id, fileId } = await ctx.params;
  try {
    const f = await readPreAnalysisFile(actor, id, fileId);
    const download = req.nextUrl.searchParams.get("baixar") === "1";
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.mime,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) return new Response("Não encontrado", { status: 404 });
    throw e;
  }
}
