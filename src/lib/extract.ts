/**
 * Leitura de dados do titular a partir de uma mensagem colada (ex.: WhatsApp do cliente).
 * Regras fixas, sem IA e sem envio a terceiros: tudo roda no aparelho. A pessoa sempre confere antes de enviar.
 */
import { cpfDigits, isValidCpf } from "./cpf";

export type Extracted = { fullName?: string; cpf?: string; email?: string; phone?: string; birthDate?: string; salary?: string };

const CPF_RE = /(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?55[\s-]?)?\(?\b([1-9]{2})\)?[\s-]?(9?\d{4})[\s.-]?(\d{4})\b/;
const DATE_RE = /(?<!\d)(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?!\d)/g;

export function extractClientData(text: string, now = new Date()): Extracted {
  const out: Extracted = {};
  if (!text.trim()) return out;
  let rest = text;

  for (const m of text.matchAll(CPF_RE)) {
    if (isValidCpf(m[1])) {
      out.cpf = cpfDigits(m[1]);
      rest = rest.replace(m[1], " ");
      break;
    }
  }
  const email = rest.match(EMAIL_RE);
  if (email) {
    out.email = email[0].toLowerCase();
    rest = rest.replace(email[0], " ");
  }

  // datas: a que estiver junto de "nasc" tem prioridade; senão, a primeira que der 18+ anos
  const dates = [...rest.matchAll(DATE_RE)].map((m) => {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const before = rest.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0).toLowerCase();
    return { raw: m[0], iso: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, y, ok: d >= 1 && d <= 31 && mo >= 1 && mo <= 12, birthLabel: /nasc/.test(before) };
  });
  const adult = (y: number) => now.getUTCFullYear() - y >= 18 && now.getUTCFullYear() - y <= 110;
  const birth = dates.find((d) => d.ok && d.birthLabel) ?? dates.find((d) => d.ok && adult(d.y));
  if (birth) {
    out.birthDate = birth.iso;
    rest = rest.replace(birth.raw, " ");
  }

  const sal = rest.match(/(?:sal[aá]rio|renda|ganho|recebo)[^\d\n]{0,20}(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)/i) ?? rest.match(/R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)/i);
  if (sal) {
    out.salary = sal[1];
    rest = rest.replace(sal[0], " ");
  }

  const phone = rest.match(PHONE_RE);
  if (phone) out.phone = `(${phone[1]}) ${phone[2].length === 5 ? `${phone[2].slice(0, 5)}` : phone[2]}-${phone[3]}`;

  // nome: "Nome: ..." ou a primeira linha só com palavras (2+)
  const labeled = text.match(/nome(?:\s+completo)?\s*[:\-–]\s*([^\n]+)/i);
  const candidate = labeled?.[1] ?? text.split(/\r?\n/).map((l) => l.trim()).find((l) => /^[A-Za-zÀ-ÿ'´`^~ ]+$/.test(l) && l.split(/\s+/).length >= 2 && l.length <= 80 && !/^(ol[aá]|oi|bom dia|boa tarde|boa noite|segue|seguem)\b/i.test(l));
  if (candidate) out.fullName = candidate.replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "");
  return out;
}
