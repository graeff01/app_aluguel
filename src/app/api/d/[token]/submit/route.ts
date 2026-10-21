import type { NextRequest } from "next/server";
import { clientApi } from "@/lib/client-api";
import { submitClientDocuments } from "@/server/doc-requests";

export const dynamic = "force-dynamic";

/** Cliente conclui o envio (a equipe é avisada). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return clientApi(req, "submit", 30, (cookie) => submitClientDocuments(token, cookie));
}
