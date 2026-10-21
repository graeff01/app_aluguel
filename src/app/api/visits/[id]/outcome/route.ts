import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { apiHandler } from "@/lib/api";
import { concludeVisit } from "@/server/visits";
import { nextPending } from "@/server/queries";
import { hasGlobalView } from "@/lib/authz";
import { db } from "@/lib/db";
import { startClientSearch } from "@/server/client-search";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return apiHandler(req, async (actor) => {
    const body = await req.json().catch(() => ({}));
    const { visit, idempotent } = await concludeVisit(actor, id, body);
    // "cliente segue procurando outro imóvel": abre a busca (falhar aqui não desfaz o resultado já salvo)
    let search: { id: string } | { error: string } | null = null;
    if (body.stillSearching === true && visit.status === "DONE" && visit.evaluation === "NEGATIVE") {
      search = await startClientSearch(actor, { visitId: id }).catch((e) => ({ error: e instanceof AppError ? e.message : "Não foi possível marcar a busca agora." }));
    }
    revalidatePath("/", "layout");
    // consultora: encadeia para a próxima pendente dela (gestão registra pontualmente)
    const next = hasGlobalView(actor) ? null : await nextPending(actor, id);
    // desfazer só para o primeiro registro (não para alterações)
    const firstConclusion = (await db.visitOutcomeHistory.count({ where: { visitId: id } })) === 1;
    return { ok: true, idempotent, version: visit.version, status: visit.status, next, undo: firstConclusion ? { visitId: id, requestId: body.requestId } : null, search };
  });
}
