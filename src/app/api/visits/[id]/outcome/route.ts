import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { apiHandler } from "@/lib/api";
import { concludeVisit } from "@/server/visits";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return apiHandler(req, async (actor) => {
    const body = await req.json().catch(() => ({}));
    const { visit, idempotent } = await concludeVisit(actor, id, body);
    revalidatePath("/", "layout");
    return { ok: true, idempotent, version: visit.version, status: visit.status };
  });
}
