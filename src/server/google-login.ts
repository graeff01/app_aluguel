/**
 * "Entrar com Google": só autentica quem JÁ está cadastrado e ativo (e-mail principal ou e-mail da agenda).
 * Sem cadastro automático. Escopos mínimos (openid, email, profile). PKCE + state + nonce.
 * No primeiro acesso a conta Google fica vinculada (googleSub); depois, outra conta Google com o mesmo e-mail é recusada.
 */
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { OAuth2Client } from "google-auth-library";
import { safeEqual } from "@/lib/crypto";
import { createSession } from "@/lib/session";
import { errorCode, log } from "@/lib/log";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { normalizeEmail } from "@/lib/text";

export const LOGIN_COOKIE = "vl_login_oauth";
/** caminho amplo: o retorno pode chegar em /api/google/callback (cadastrado) ou /api/auth/google/callback */
export const LOGIN_COOKIE_PATH = "/api";

export function loginClient() {
  return new OAuth2Client({ clientId: env.googleClientId, clientSecret: env.googleClientSecret, redirectUri: env.googleLoginRedirectUri });
}

export type LoginFailure = "sem_cadastro" | "inativo" | "nao_verificado" | "conta_diferente";

/** Resolve o usuário a partir da identidade verificada do Google. */
export async function resolveGoogleUser(identity: { sub: string; email: string; emailVerified: boolean }) {
  if (!identity.emailVerified) return { error: "nao_verificado" as LoginFailure };
  const email = normalizeEmail(identity.email);
  const bySub = await db.user.findUnique({ where: { googleSub: identity.sub } });
  const user =
    bySub ??
    (await db.user.findUnique({ where: { email } })) ??
    (await db.userEmailAlias.findUnique({ where: { email }, include: { user: true } }))?.user ??
    null;
  if (!user) return { error: "sem_cadastro" as LoginFailure };
  if (!user.active) return { error: "inativo" as LoginFailure };
  if (user.googleSub && user.googleSub !== identity.sub) return { error: "conta_diferente" as LoginFailure };

  const tempPassword = user.mustChangePassword;
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        ...(user.googleSub ? {} : { googleSub: identity.sub }),
        // senha provisória deixa de valer: quem entra com Google não precisa dela
        ...(tempPassword ? { passwordHash: null, mustChangePassword: false } : {}),
      },
    });
    await audit(tx, { actorId: user.id, action: "auth.google_login", entityType: "User", entityId: user.id, changes: { vinculou: !user.googleSub, senhaProvisoriaDescartada: tempPassword } });
  });
  return { user };
}

type Saved = { state?: string; nonce?: string; verifier?: string };

/** Há um login com Google em andamento cujo estado confere com o retorno? (decide entre login e conexão da agenda) */
export async function pendingLogin(req: NextRequest): Promise<Saved | null> {
  const raw = (await cookies()).get(LOGIN_COOKIE)?.value;
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Saved;
    return saved.state && safeEqual(req.nextUrl.searchParams.get("state") ?? "", saved.state) ? saved : null;
  } catch {
    return null;
  }
}

/** Retorno do "Entrar com Google": valida estado, PKCE e nonce; só entra quem já tem cadastro ativo. */
export async function handleLoginCallback(req: NextRequest, saved: Saved | null) {
  const back = (erro: string) => NextResponse.redirect(new URL(`/login?erro=${erro}`, env.appUrl));
  const jar = await cookies();
  jar.delete({ name: LOGIN_COOKIE, path: LOGIN_COOKIE_PATH });
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(sp.get("error") === "access_denied" ? "google_cancelado" : "google_falhou");
  const code = sp.get("code");
  if (!saved?.state || !saved.verifier || !saved.nonce || !code || !safeEqual(sp.get("state") ?? "", saved.state)) return back("google_expirou");
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
    await createSession(r.user!.id);
    return NextResponse.redirect(new URL("/", env.appUrl));
  } catch (e) {
    log.error("auth.google_login_failed", { code: errorCode(e) });
    return back("google_falhou");
  }
}
