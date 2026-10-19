import type { NextRequest } from "next/server";
import { getActor } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { readLeasePhoto } from "@/server/lease-photos";

export const dynamic = "force-dynamic";

/** Foto do anúncio guardada na locação (marketing e gestão). `?baixar=1` baixa o arquivo. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ photoId: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Não autenticado", { status: 401 });
  const { photoId } = await ctx.params;
  try {
    const f = await readLeasePhoto(actor, photoId);
    const download = req.nextUrl.searchParams.get("baixar") === "1";
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.mime,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${f.name}"`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) return new Response("Não encontrado", { status: 404 });
    throw e;
  }
}
