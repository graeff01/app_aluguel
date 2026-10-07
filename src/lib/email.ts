/**
 * E-mail transacional (opcional) via API HTTP do Resend — sem SDK.
 * Desativado enquanto RESEND_API_KEY e EMAIL_FROM não estiverem definidos.
 */
import { env } from "./env";

export function emailConfig() {
  const key = process.env.RESEND_API_KEY ?? "";
  const from = process.env.EMAIL_FROM ?? "";
  return key && from ? { key, from } : null;
}

export type EmailSender = (to: string, subject: string, text: string) => Promise<boolean>;

export const sendEmail: EmailSender = async (to, subject, text) => {
  const cfg = emailConfig();
  if (!cfg) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

export function appLink(path: string) {
  return `${env.appUrl}${path}`;
}
