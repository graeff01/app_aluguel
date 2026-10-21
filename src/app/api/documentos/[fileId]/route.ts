import type { NextRequest } from "next/server";
import { getActor } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { readClientDocument } from "@/server/doc-requests";

export const dynamic = "force-dynamic";

/** Equipe abre/baixa um documento enviado pelo cliente (decifrado na hora; auditado). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Não autenticado", { status: 401 });
  const { fileId } = await ctx.params;
  try {
    const f = await readClientDocument(actor, fileId);
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
