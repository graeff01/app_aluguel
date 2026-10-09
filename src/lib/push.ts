import webpush from "web-push";
import { env } from "./env";

/** Chaves VAPID (Web Push). Sem elas, os lembretes ficam desativados sem afetar o resto do app. */
export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!publicKey || !privateKey) return null;
  const subject = process.env.VAPID_SUBJECT || env.appUrl;
  return { publicKey, privateKey, subject };
}

export type PushAction = { action: string; title: string; url: string };
/** actions: atalhos na notificação (Android/Chrome; no iPhone a notificação só abre o link principal). badge: número no ícone do app. */
export type PushPayload = { title: string; body: string; url: string; tag: string; actions?: PushAction[]; badge?: number };

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** Envia uma notificação. Retorna "gone" quando a inscrição expirou (deve ser apagada). */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<"ok" | "gone" | "error"> {
  const cfg = pushConfig();
  if (!cfg) return "error";
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey }, TTL: 6 * 3600, urgency: "normal" },
    );
    return "ok";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? "gone" : "error";
  }
}
