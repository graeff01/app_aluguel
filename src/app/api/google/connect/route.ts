import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActor } from "@/lib/session";
import { canManageIntegration } from "@/lib/authz";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { authUrl, googleConfigured } from "@/server/sync/google";

/** Inicia OAuth (servidor). Estado anti-CSRF em cookie HttpOnly de curta duração. */
export async function GET() {
  const actor = await getActor();
  if (!actor || !canManageIntegration(actor)) return NextResponse.redirect(new URL("/login", env.appUrl));
  if (!googleConfigured()) return NextResponse.redirect(new URL("/admin/google?erro=nao_configurado", env.appUrl));
  const state = randomToken(24);
  (await cookies()).set("vl_oauth_state", state, { httpOnly: true, secure: env.secureCookies, sameSite: "lax", path: "/api/google", maxAge: 600 });
  return NextResponse.redirect(authUrl(state));
}
