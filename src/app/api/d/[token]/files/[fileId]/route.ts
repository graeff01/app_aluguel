import type { NextRequest } from "next/server";
import { clientApi } from "@/lib/client-api";
import { removeClientDocument } from "@/server/doc-requests";

export const dynamic = "force-dynamic";

/** Cliente remove um arquivo que enviou (antes de concluir). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await ctx.params;
  return clientApi(req, "remove", 200, (cookie) => removeClientDocument(token, cookie, fileId));
}
