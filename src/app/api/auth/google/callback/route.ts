import type { NextRequest } from "next/server";
import { handleLoginCallback, pendingLogin } from "@/server/google-login";

export const dynamic = "force-dynamic";

/** Retorno alternativo do "Entrar com Google" (quando GOOGLE_LOGIN_REDIRECT_URI aponta para cá). */
export async function GET(req: NextRequest) {
  return handleLoginCallback(req, await pendingLogin(req));
}
