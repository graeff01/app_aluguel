import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { apiHandler } from "@/lib/api";
import { undoConclusion } from "@/server/visits";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return apiHandler(req, async (actor) => {
    const body = (await req.json().catch(() => ({}))) as { requestId?: string };
    if (!body.requestId) throw new AppError("VALIDATION", "Requisição inválida.");
    const visit = await undoConclusion(actor, id, body.requestId);
    revalidatePath("/", "layout");
    return { ok: true, version: visit.version };
  });
}
