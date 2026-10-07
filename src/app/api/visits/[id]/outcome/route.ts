import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { apiHandler } from "@/lib/api";
import { concludeVisit } from "@/server/visits";
import { nextPending } from "@/server/queries";
import { hasGlobalView } from "@/lib/authz";
import { db } from "@/lib/db";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return apiHandler(req, async (actor) => {
    const body = await req.json().catch(() => ({}));
    const { visit, idempotent } = await concludeVisit(actor, id, body);
    revalidatePath("/", "layout");
    // consultora: encadeia para a próxima pendente dela (gestão registra pontualmente)
    const next = hasGlobalView(actor) ? null : await nextPending(actor, id);
    // desfazer só para o primeiro registro (não para alterações)
    const firstConclusion = (await db.visitOutcomeHistory.count({ where: { visitId: id } })) === 1;
    return { ok: true, idempotent, version: visit.version, status: visit.status, next, undo: firstConclusion ? { visitId: id, requestId: body.requestId } : null };
  });
}
