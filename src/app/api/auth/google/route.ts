import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/session";
import { hitRateLimit } from "@/lib/ratelimit";
import { googleConfigured } from "@/server/sync/google";
import { LOGIN_COOKIE, loginClient } from "@/server/google-login";

export const dynamic = "force-dynamic";

/** Inicia o "Entrar com Google" (servidor). */
export async function GET() {
  const back = (erro: string) => NextResponse.redirect(new URL(`/login?erro=${erro}`, env.appUrl));
  if (!googleConfigured()) return back("google_indisponivel");
  if (!(await hitRateLimit(`google_login:ip:${await clientIp()}`, 30, 900)).allowed) return back("muitas_tentativas");
  const client = loginClient();
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = randomToken(24);
  const nonce = randomToken(24);
  (await cookies()).set(LOGIN_COOKIE, JSON.stringify({ state, nonce, verifier: codeVerifier }), {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  const url = client.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    nonce,
    prompt: "select_account",
    code_challenge_method: "S256" as never,
    code_challenge: codeChallenge,
  });
  return NextResponse.redirect(url);
}
