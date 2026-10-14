/**
 * Confirmação de presença: mensagem pronta no WhatsApp, aberta pela consultora (nada é enviado automaticamente).
 * Placeholders: {cliente} {consultora} {dia} {hora} {codigo} {bairro}
 */
import { TZ, dayKey, addDays } from "./time";

export function confirmDayLabel(start: Date, now = new Date()) {
  const k = dayKey(start);
  if (k === dayKey(now)) return "hoje";
  if (k === addDays(dayKey(now), 1)) return "amanhã";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit" }).format(start).replace(",", "");
}

export function buildConfirmMessage(
  template: string,
  v: { clientName: string | null; consultantName: string | null; scheduledStart: Date; propertyCode: string | null; neighborhood: string | null },
  now = new Date(),
) {
  const first = (s: string | null) => (s ?? "").trim().split(/\s+/)[0] ?? "";
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(v.scheduledStart);
  return template
    .replace(/\{cliente\}/g, first(v.clientName) || "tudo bem")
    .replace(/\{consultora\}/g, first(v.consultantName) || "a consultora")
    .replace(/\{dia\}/g, confirmDayLabel(v.scheduledStart, now))
    .replace(/\{hora\}/g, hora)
    .replace(/\{codigo\}/g, v.propertyCode ?? "")
    .replace(/\{bairro\}/g, v.neighborhood ? ` (${v.neighborhood})` : "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function whatsappUrl(phoneE164: string, text: string) {
  return `https://wa.me/${phoneE164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
