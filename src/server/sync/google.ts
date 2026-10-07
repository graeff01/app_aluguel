/**
 * Integração real com a Google Calendar API (somente leitura) via OAuth no servidor.
 * Escopos mínimos: listar calendários + ler eventos. Tokens ficam criptografados no banco.
 */
import { OAuth2Client } from "google-auth-library";
import { calendar, type calendar_v3 } from "@googleapis/calendar";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { GoogleApiError, type CalendarApi, type GEvent, type ListPage, type ListParams } from "./types";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];
export const REQUIRED_CALENDAR_SCOPES = GOOGLE_SCOPES.slice(2);

export function googleConfigured() {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

export function oauthClient() {
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: env.googleRedirectUri,
  });
}

export function authUrl(state: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
}

/** Converte erros do gaxios/Google em categorias tratáveis. */
export function mapGoogleError(e: unknown): GoogleApiError {
  if (e instanceof GoogleApiError) return e;
  const err = e as {
    status?: number;
    code?: number | string;
    response?: { status?: number; headers?: Record<string, string> | Headers; data?: { error?: string | { errors?: { reason?: string }[] } } };
    message?: string;
  };
  const status = err.response?.status ?? (typeof err.status === "number" ? err.status : typeof err.code === "number" ? err.code : null);
  const data = err.response?.data?.error;
  const reason = typeof data === "string" ? data : data?.errors?.[0]?.reason ?? null;
  const headers = err.response?.headers;
  const ra = headers instanceof Headers ? headers.get("retry-after") : headers?.["retry-after"];
  const retryAfterMs = ra ? Number(ra) * 1000 : null;

  if (reason === "invalid_grant" || reason === "invalid_client" || reason === "unauthorized_client") return new GoogleApiError("AUTH", status, null, reason);
  if (status === 410) return new GoogleApiError("SYNC_TOKEN_INVALID", 410, null, reason);
  if (status === 401) return new GoogleApiError("AUTH", 401, null, reason);
  if (status === 404) return new GoogleApiError("NOT_FOUND", 404, null, reason);
  if (status === 429 || (status === 403 && reason && /rateLimit|userRateLimit|quota/i.test(reason))) {
    return new GoogleApiError("RETRYABLE", status, retryAfterMs, reason);
  }
  if (status === 403) return new GoogleApiError("PERMISSION", 403, null, reason);
  if (status && status >= 500) return new GoogleApiError("RETRYABLE", status, retryAfterMs, reason);
  const code = typeof err.code === "string" ? err.code : "";
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up/i.test(code + " " + (err.message ?? ""))) {
    return new GoogleApiError("RETRYABLE", null, null, code || "NETWORK");
  }
  return new GoogleApiError("OTHER", status, null, reason);
}

/** Cliente autenticado a partir da conexão salva; persiste tokens renovados. */
export async function authorizedClient(connectionId: string) {
  const conn = await db.googleConnection.findUniqueOrThrow({ where: { id: connectionId } });
  if (!conn.refreshTokenEnc) throw new GoogleApiError("AUTH", null, null, "missing_refresh_token");
  const client = oauthClient();
  client.setCredentials({
    refresh_token: decryptSecret(conn.refreshTokenEnc),
    access_token: conn.accessTokenEnc ? decryptSecret(conn.accessTokenEnc) : undefined,
    expiry_date: conn.accessTokenExpiresAt?.getTime(),
  });
  client.on("tokens", (tokens) => {
    const data: Record<string, unknown> = {};
    if (tokens.access_token) data.accessTokenEnc = encryptSecret(tokens.access_token);
    if (tokens.expiry_date) data.accessTokenExpiresAt = new Date(tokens.expiry_date);
    if (tokens.refresh_token) data.refreshTokenEnc = encryptSecret(tokens.refresh_token);
    db.googleConnection
      .update({ where: { id: connectionId }, data })
      .catch(() => log.warn("google.token_persist_failed", { connectionId }));
  });
  return client;
}

export function realCalendarApi(auth: OAuth2Client): CalendarApi {
  const api = calendar({ version: "v3", auth });
  return {
    async listCalendars() {
      const out: { id: string; summary: string; accessRole: string; primary?: boolean }[] = [];
      let pageToken: string | undefined;
      try {
        do {
          const res = await api.calendarList.list({ maxResults: 250, pageToken, showHidden: true });
          for (const c of res.data.items ?? []) {
            if (c.id) out.push({ id: c.id, summary: c.summaryOverride || c.summary || c.id, accessRole: c.accessRole ?? "none", primary: !!c.primary });
          }
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      } catch (e) {
        throw mapGoogleError(e);
      }
      return out;
    },
    async listEvents(p: ListParams): Promise<ListPage> {
      // Mesmos parâmetros em todas as chamadas; com syncToken, timeMin/timeMax/orderBy/q/updatedMin não podem ser enviados.
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId: p.calendarId,
        singleEvents: true,
        showDeleted: true,
        maxResults: 250,
        pageToken: p.pageToken,
      };
      if (p.syncToken) params.syncToken = p.syncToken;
      else {
        params.timeMin = p.timeMin;
        params.timeMax = p.timeMax;
      }
      try {
        const res = await api.events.list(params);
        return {
          items: (res.data.items ?? []) as GEvent[],
          nextPageToken: res.data.nextPageToken,
          nextSyncToken: res.data.nextSyncToken,
        };
      } catch (e) {
        throw mapGoogleError(e);
      }
    },
    async getEvent(calendarId, eventId) {
      try {
        const res = await api.events.get({ calendarId, eventId });
        return res.data as GEvent;
      } catch (e) {
        const m = mapGoogleError(e);
        if (m.kind === "NOT_FOUND" || m.status === 410) return null;
        throw m;
      }
    },
  };
}

/** Revoga o token no Google (melhor esforço). */
export async function revokeToken(refreshTokenEnc: string | null) {
  if (!refreshTokenEnc) return;
  try {
    await oauthClient().revokeToken(decryptSecret(refreshTokenEnc));
  } catch {
    log.warn("google.revoke_failed");
  }
}
