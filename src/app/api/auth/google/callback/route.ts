import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { createSession } from "@/lib/session";
import { errorCode, log } from "@/lib/log";
import { LOGIN_COOKIE, loginClient, resolveGoogleUser } from "@/server/google-login";

export const dynamic = "force-dynamic";

/** Retorno do "Entrar com Google": valida estado, PKCE e nonce; só entra quem já tem cadastro ativo. */
export async function GET(req: NextRequest) {
  const back = (erro: string) => NextResponse.redirect(new URL(`/login?erro=${erro}`, env.appUrl));
  const jar = await cookies();
  const raw = jar.get(LOGIN_COOKIE)?.value;
  jar.delete({ name: LOGIN_COOKIE, path: "/api/auth" });
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(sp.get("error") === "access_denied" ? "google_cancelado" : "google_falhou");
  let saved: { state?: string; nonce?: string; verifier?: string } = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {}
  const code = sp.get("code");
  if (!saved.state || !saved.verifier || !saved.nonce || !code || !safeEqual(sp.get("state") ?? "", saved.state)) return back("google_expirou");
  try {
    const client = loginClient();
    const { tokens } = await client.getToken({ code, codeVerifier: saved.verifier });
    if (!tokens.id_token) return back("google_falhou");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email || p.nonce !== saved.nonce) return back("google_falhou");
    // o app não guarda tokens do login, só a identidade verificada. NÃO revogar: revogaria também a conexão da agenda
    // quando a mesma conta Google estiver conectada como agenda central.
    const r = await resolveGoogleUser({ sub: p.sub, email: p.email, emailVerified: p.email_verified === true });
    if ("error" in r) {
      log.warn("auth.google_login_refused", { reason: r.error });
      return back(r.error ?? "google_falhou");
    }
    await createSession(r.user.id);
    return NextResponse.redirect(new URL("/", env.appUrl));
  } catch (e) {
    log.error("auth.google_login_failed", { code: errorCode(e) });
    return back("google_falhou");
  }
}
