import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getActor } from "@/lib/session";
import { canManageIntegration } from "@/lib/authz";
import { db } from "@/lib/db";
import { encryptSecret, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { errorCode, log } from "@/lib/log";
import { oauthClient, REQUIRED_CALENDAR_SCOPES } from "@/server/sync/google";

function back(q: string) {
  return NextResponse.redirect(new URL(`/admin/google?${q}`, env.appUrl));
}

export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor || !canManageIntegration(actor)) return NextResponse.redirect(new URL("/login", env.appUrl));
  const jar = await cookies();
  const expected = jar.get("vl_oauth_state")?.value ?? "";
  jar.delete({ name: "vl_oauth_state", path: "/api/google" });
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(`erro=${encodeURIComponent(sp.get("error") === "access_denied" ? "negado" : "google")}`);
  const state = sp.get("state") ?? "";
  const code = sp.get("code");
  if (!expected || !safeEqual(state, expected) || !code) return back("erro=estado");

  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    const granted = (tokens.scope ?? "").split(" ");
    const missing = REQUIRED_CALENDAR_SCOPES.filter((s) => !granted.includes(s));
    if (missing.length) {
      // consentimento granular: usuário desmarcou permissões necessárias
      if (tokens.access_token) await client.revokeToken(tokens.access_token).catch(() => undefined);
      return back("erro=escopos");
    }
    if (!tokens.refresh_token) return back("erro=sem_refresh");
    const ticket = tokens.id_token ? await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId }) : null;
    const payload = ticket?.getPayload();
    if (!payload?.email || !payload.sub) return back("erro=identidade");

    await db.$transaction(async (tx) => {
      const previous = await tx.googleConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } });
      const sameAccount = previous?.googleSub === payload.sub;
      await tx.googleConnection.updateMany({ where: { status: { not: "DISCONNECTED" } }, data: { status: "DISCONNECTED", refreshTokenEnc: null, accessTokenEnc: null } });
      const created = await tx.googleConnection.create({
        data: {
          googleEmail: payload.email!.toLowerCase(),
          googleSub: payload.sub,
          refreshTokenEnc: encryptSecret(tokens.refresh_token!),
          accessTokenEnc: tokens.access_token ? encryptSecret(tokens.access_token) : null,
          accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          scopes: granted.join(" "),
          status: "CONNECTED",
          connectedById: actor.id,
          // reconexão da mesma conta mantém o calendário selecionado
          calendarId: sameAccount ? previous?.calendarId : null,
          calendarSummary: sameAccount ? previous?.calendarSummary : null,
          calendarAccessRole: sameAccount ? previous?.calendarAccessRole : null,
        },
      });
      await audit(tx, { actorId: actor.id, action: sameAccount ? "google.reconnected" : "google.connected", entityType: "GoogleConnection", entityId: created.id });
    });
    return back("ok=1");
  } catch (e) {
    log.error("google.oauth_failed", { code: errorCode(e) });
    return back("erro=troca");
  }
}
