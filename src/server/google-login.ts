/**
 * "Entrar com Google": só autentica quem JÁ está cadastrado e ativo (e-mail principal ou e-mail da agenda).
 * Sem cadastro automático. Escopos mínimos (openid, email, profile). PKCE + state + nonce.
 * No primeiro acesso a conta Google fica vinculada (googleSub); depois, outra conta Google com o mesmo e-mail é recusada.
 */
import { OAuth2Client } from "google-auth-library";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { normalizeEmail } from "@/lib/text";

export const LOGIN_COOKIE = "vl_login_oauth";

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
