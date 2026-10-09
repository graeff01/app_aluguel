/** Dados que não devem ir para a observação (documentos pessoais). Só aviso — quem digita decide. */
export function looksLikeDocument(text: string) {
  return /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\bcpf\b|\brg\b\s*[:nº]?\s*\d/i.test(text);
}
