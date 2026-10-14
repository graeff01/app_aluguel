import type { NextRequest } from "next/server";
import { getActor } from "@/lib/session";
import { canManageClients } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { exportClientData } from "@/server/privacy";

export const dynamic = "force-dynamic";

/** Download dos dados do titular (LGPD). Somente gestão; registrado na auditoria. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Não autenticado", { status: 401 });
  if (!canManageClients(actor)) return new Response("Sem permissão", { status: 403 });
  const { id } = await ctx.params;
  try {
    const data = await exportClientData(actor, id);
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="dados-do-titular-${id.slice(-8)}.json"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") return new Response("Não encontrado", { status: 404 });
    throw e;
  }
}
