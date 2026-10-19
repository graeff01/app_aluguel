import { getActor } from "@/lib/session";
import { AppError } from "@/lib/errors";
import { leasePhotosZip } from "@/server/lease-photos";

export const dynamic = "force-dynamic";

/** Todas as fotos da locação num .zip (marketing e gestão). */
export async function GET(_: Request, ctx: { params: Promise<{ postId: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Não autenticado", { status: 401 });
  const { postId } = await ctx.params;
  try {
    const z = await leasePhotosZip(actor, postId);
    return new Response(new Uint8Array(z.data), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.name}"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) return new Response("Não encontrado", { status: 404 });
    throw e;
  }
}
