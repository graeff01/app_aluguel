import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export type PhoneResult = {
  raw: string;
  /** E.164 quando válido */
  normalized: string | null;
  valid: boolean;
  /** motivo quando inválido */
  problem: "VAZIO" | "SEM_DDD" | "INCOMPLETO" | "INVALIDO" | null;
};

/**
 * Normaliza telefone sem inventar dígitos.
 * - Com "+" ou prefixo 55 explícito: interpreta como internacional.
 * - 10/11 dígitos: DDD + número brasileiro.
 * - Menos dígitos: inválido (não acrescenta DDD).
 */
export function normalizePhone(rawInput: string | null | undefined): PhoneResult {
  const raw = (rawInput ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return { raw, normalized: null, valid: false, problem: "VAZIO" };

  let candidate: string | null = null;
  if (raw.startsWith("+")) candidate = "+" + digits;
  else if (raw.startsWith("00")) candidate = "+" + digits.slice(2);
  else if (digits.length >= 12 && digits.length <= 13 && digits.startsWith("55")) candidate = "+" + digits;
  else if (digits.length === 10 || digits.length === 11) candidate = "+55" + digits;
  else if (digits.length === 12 && digits.startsWith("0")) candidate = "+55" + digits.slice(1); // 0 + DDD + número
  else if (digits.length === 8 || digits.length === 9) return { raw, normalized: null, valid: false, problem: "SEM_DDD" };
  else return { raw, normalized: null, valid: false, problem: digits.length < 8 ? "INCOMPLETO" : "INVALIDO" };

  const parsed = parsePhoneNumberFromString(candidate);
  if (!parsed || !parsed.isValid()) return { raw, normalized: null, valid: false, problem: "INVALIDO" };
  return { raw, normalized: parsed.number, valid: true, problem: null };
}

export function formatPhone(normalized: string | null | undefined, raw?: string | null): string {
  if (normalized) {
    const p = parsePhoneNumberFromString(normalized);
    if (p) return p.country === "BR" ? p.formatNational() : p.formatInternational();
  }
  return raw ?? "";
}

export const PHONE_PROBLEM_LABEL: Record<NonNullable<PhoneResult["problem"]>, string> = {
  VAZIO: "Telefone ausente",
  SEM_DDD: "Telefone sem DDD",
  INCOMPLETO: "Telefone incompleto",
  INVALIDO: "Telefone inválido",
};
