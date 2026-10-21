import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { clientApi } from "@/lib/client-api";
import { env } from "@/lib/env";
import { SESSION_COOKIE, verifyClient } from "@/server/doc-requests";

export const dynamic = "force-dynamic";

/** Cliente confirma a identidade (dígitos do CPF ou do celular) e recebe a sessão do link. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return clientApi(req, "verify", 30, async () => {
    const body = (await req.json().catch(() => ({}))) as { digits?: string };
    const session = await verifyClient(token, String(body.digits ?? ""));
    (await cookies()).set(SESSION_COOKIE, session, { httpOnly: true, secure: env.secureCookies, sameSite: "lax", path: "/", maxAge: 3 * 3600 });
    return { ok: true };
  });
}
