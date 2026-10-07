/** Normaliza texto para comparação: minúsculo, sem acentos, espaços simples. */
export function normalizeText(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Remove espaços e retorna null quando vazio. */
export function cleanOptional(input: string | null | undefined): string | null {
  const v = (input ?? "").replace(/\s+/g, " ").trim();
  return v.length ? v : null;
}

/** Nomes compatíveis: primeiro nome igual, ou tokens de um contidos no outro. */
export function namesCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = normalizeText(a).split(" ").filter((t) => t.length > 1);
  const tb = normalizeText(b).split(" ").filter((t) => t.length > 1);
  if (!ta.length || !tb.length) return false;
  if (ta[0] === tb[0]) return true;
  const sa = new Set(ta);
  const sb = new Set(tb);
  return ta.every((t) => sb.has(t)) || tb.every((t) => sa.has(t));
}
