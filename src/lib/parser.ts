/**
 * Parser determinístico de eventos da agenda.
 * Nenhum dado é enviado a serviços externos/IA. Todas as regras são testáveis em tests/unit/parser.test.ts.
 */
import { normalizeText, normalizeEmail } from "./text";
import { normalizePhone } from "./phone";

export type PatternConfig = {
  visitPrefixes: string[]; // ex.: ["visita clt"]
  excludeTerms: string[]; // ex.: ["visita tecnica", "almoco", "reuniao"]
  ambiguousTerms: string[]; // ex.: ["visita", "cod"]
};

export const DEFAULT_PATTERNS: PatternConfig = {
  visitPrefixes: ["visita clt"],
  excludeTerms: ["visita tecnica", "almoco", "reuniao", "treinamento", "particular"],
  ambiguousTerms: ["visita", "cod", "cliente"],
};

export type Classification =
  | { cls: "VISIT"; prefix: string }
  | { cls: "AMBIGUOUS"; term: string }
  | { cls: "IRRELEVANT" };

/** Classifica pelo título (com tolerância a maiúsculas, espaços e acentos). */
export function classifyTitle(title: string | null | undefined, cfg: PatternConfig): Classification {
  const t = normalizeText(title);
  if (!t) return { cls: "IRRELEVANT" };
  const prefixes = [...cfg.visitPrefixes].map(normalizeText).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (t === p || t.startsWith(p + " ") || t.startsWith(p + "-") || t.startsWith(p + ":")) return { cls: "VISIT", prefix: p };
  }
  for (const ex of cfg.excludeTerms.map(normalizeText).filter(Boolean)) {
    if (containsTerm(t, ex)) return { cls: "IRRELEVANT" };
  }
  // "Visita - Imóvel 836505 - Sergio 21 97906-8408", "isita clt - …" (letra faltando): começa com visita e tem código + telefone
  if (/^v?isita\b/.test(t) && title) {
    const p = parseVisitEvent(title, null, "");
    if (p.propertyCode && p.phoneNormalized) return { cls: "VISIT", prefix: "" };
  }
  for (const am of cfg.ambiguousTerms.map(normalizeText).filter(Boolean)) {
    if (containsTerm(t, am)) return { cls: "AMBIGUOUS", term: am };
  }
  return { cls: "IRRELEVANT" };
}

function containsTerm(haystack: string, term: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(term)}($|[^a-z0-9])`);
  return re.test(haystack);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type ParseIssue =
  | "MISSING_NAME"
  | "MISSING_CODE"
  | "MISSING_PHONE"
  | "INVALID_PHONE"
  | "PHONE_CONFLICT"
  | "CODE_CONFLICT";

export type ParsedVisit = {
  clientName: string | null;
  propertyCode: string | null;
  /** demais imóveis do mesmo evento ("cod 339541;835840"): cada um vira uma visita */
  extraPropertyCodes: string[];
  phoneRaw: string | null;
  phoneNormalized: string | null;
  externalRef: string | null;
  issues: ParseIssue[];
};

// "cod 654321", "Cód: 654321", "codigo 0123", "cod. AB-12", "Imóvel 654321"
const COD_RE = /(?:^|[\s(\[,;])(?:c[oó]d(?:igo)?|im[oó]vel)(?![A-Za-zÀ-ÿ])\.?\s*(?:do\s+im[oó]vel)?\s*(?:n[º°o]\.?)?\s*[:#º°.]*\s*([0-9A-Za-z][0-9A-Za-z\-\/]*)/i;
const PHONE_SEGMENT_RE = /^[+()\d\s.\-]+$/;
/** códigos de imóvel entre parênteses: "(844530;844529)" — 5 a 8 dígitos (não confunde com o DDD "(51)") */
const CODE_LIST_RE = /\(\s*(\d{5,8}(?:\s*[;,]\s*\d{5,8})*)\s*\)/;
const SEPARATOR_RE = /\s*[–—|]\s*|\s+-\s*|\s*-\s+/;

/** Remove bloco do Google Meet/conferência e linhas de discagem/PIN. */
export function stripConferenceBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/-::~:~::~/.test(line)) break; // separador padrão do bloco do Meet
    const n = normalizeText(line);
    if (
      /meet\.google\.com|g\.co\/meet|zoom\.us|teams\.microsoft/.test(n) ||
      /\bpin\b/.test(n) ||
      /participar|participe|join (with|by)|dial-in|mais numeros|more phone numbers|google meet/.test(n)
    ) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

const LABELS = {
  phone: /^(?:telefone|tel|fone|celular|cel|whats(?:app)?|contato)\s*(?:do cliente)?\s*[:\-–]\s*(.+)$/i,
  name: /^(?:cliente|nome(?: do cliente)?)\s*[:\-–]\s*(.+)$/i,
  code: /^(?:c[oó]d(?:igo)?\.?(?:\s*(?:do\s*)?im[oó]vel)?|im[oó]vel)\s*[:\-–#]\s*([0-9A-Za-z][0-9A-Za-z\-\/]*)/i,
};

function parseDescription(desc: string | null | undefined) {
  const res: { name?: string; phone?: string; code?: string } = {};
  if (!desc) return res;
  for (const rawLine of stripConferenceBlock(desc).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if (!res.phone && (m = line.match(LABELS.phone))) {
      const digits = m[1].replace(/\D/g, "");
      if (digits.length >= 8 && digits.length <= 14) res.phone = m[1].trim();
    } else if (!res.code && (m = line.match(LABELS.code))) res.code = m[1].trim();
    else if (!res.name && (m = line.match(LABELS.name))) res.name = m[1].trim();
  }
  return res;
}

/**
 * Extrai campos do título no formato
 *   "Visita clt - Nome Cliente 1234567 - cod 654321 - (51) 99999-9999"
 * e, como alternativa, de campos rotulados da descrição.
 */
export function parseVisitEvent(title: string, description: string | null | undefined, prefix: string): ParsedVisit {
  const issues: ParseIssue[] = [];
  const segments = title.split(SEPARATOR_RE).map((s) => s.trim()).filter(Boolean);

  let name: string | null = null;
  let code: string | null = null;
  const extraCodes: string[] = [];
  let phone: string | null = null;
  let externalRef: string | null = null;
  const prefixTokens = prefix.split(" ").length;

  segments.forEach((segment, idx) => {
    let seg = segment;
    if (idx === 0 && !prefix && segments.length > 1) {
      // evento aceito na revisão (sem prefixo conhecido): o 1º segmento é um rótulo livre, ex. "Visita apto"
      const named = seg.match(/^[Vv]?isita\s+([A-ZÀ-Ý][^\d]*)$/);
      if (named) seg = named[1].trim();
      else if (!COD_RE.test(seg) && !PHONE_SEGMENT_RE.test(seg) && !CODE_LIST_RE.test(seg)) return;
    }
    if (idx === 0 && prefix) {
      // remove o prefixo (comparando tokens normalizados)
      const tokens = seg.split(/\s+/);
      seg = tokens.slice(prefixTokens).join(" ").replace(/^[:\-]\s*/, "").trim();
      if (!seg) return;
    }
    const list = seg.match(CODE_LIST_RE);
    if (list) {
      const codes = list[1].split(/\s*[;,]\s*/);
      if (!code) code = codes[0];
      for (const x of codes) if (x !== code && !extraCodes.includes(x)) extraCodes.push(x);
      seg = `${seg.slice(0, list.index)} ${seg.slice((list.index ?? 0) + list[0].length)}`.trim();
      if (!seg) return;
    }
    const cod = seg.match(COD_RE);
    if (cod && /\d/.test(cod[1])) {
      let c = cod[1];
      let rest = seg.slice((cod.index ?? 0) + cod[0].length);
      // vários imóveis no mesmo evento: "cod 339541;835840" (também aceita vírgula)
      const more: string[] = [];
      for (let m; (m = rest.match(/^\s*[;,]\s*([0-9A-Za-z][0-9A-Za-z\-\/]*)/)); rest = rest.slice(m[0].length)) if (/\d/.test(m[1])) more.push(m[1]);
      // telefone colado ao código sem " - ": "cod 487323-51 9851-5679" → código 487323, telefone 51 9851-5679
      const ddd = (more.at(-1) ?? c).match(/^(\d{3,})-(\d{2})$/);
      if (ddd && /^\s+[\d\s.\-]+$/.test(rest) && rest.replace(/\D/g, "").length >= 8) {
        if (more.length) more[more.length - 1] = ddd[1];
        else c = ddd[1];
        if (!phone) phone = `${ddd[2]} ${rest.trim()}`;
      } else if (PHONE_SEGMENT_RE.test(rest.trim()) && rest.replace(/\D/g, "").length >= 8 && !phone) phone = rest.trim();
      if (!code) {
        code = c;
        for (const x of more) if (x !== code && !extraCodes.includes(x)) extraCodes.push(x);
      }
      const before = seg.slice(0, cod.index ?? 0).trim();
      if (before && !name) takeName(before);
      return;
    }
    if (PHONE_SEGMENT_RE.test(seg)) {
      const digits = seg.replace(/\D/g, "");
      if (digits.length >= 8) {
        if (!phone) phone = seg;
        return;
      }
      if (!name && !externalRef && digits.length > 0) {
        externalRef = digits;
        return;
      }
    }
    if (!name) takeName(seg);
  });

  function takeName(text: string) {
    const tail = text.match(/^(.*[A-Za-zÀ-ÿ].*?)[\s,]+(\(?\d{2}\)?[\s.]*9?\d{4}[\s.\-]?\d{4})$/);
    if (tail) {
      if (!phone) phone = tail[2];
      text = tail[1];
    }
    // número isolado ao final (antes do "cod"): referência externa, não imóvel/cliente
    const m = text.match(/^(.*?)[\s,]+(\d{3,})$/);
    let candidate = text;
    if (m && /[A-Za-zÀ-ÿ]/.test(m[1])) {
      candidate = m[1];
      if (!externalRef) externalRef = m[2];
    }
    candidate = candidate.replace(/\s+/g, " ").trim();
    if (/[A-Za-zÀ-ÿ]{2,}/.test(candidate)) name = candidate;
  }

  const fromDesc = parseDescription(description);
  if (!name && fromDesc.name) name = fromDesc.name;
  if (!code && fromDesc.code) code = fromDesc.code;
  else if (code && fromDesc.code && normalizeText(code) !== normalizeText(fromDesc.code)) issues.push("CODE_CONFLICT");

  let normalized: string | null = null;
  if (!phone && fromDesc.phone) phone = fromDesc.phone;
  else if (phone && fromDesc.phone) {
    const a = normalizePhone(phone).normalized;
    const b = normalizePhone(fromDesc.phone).normalized;
    if (a && b && a !== b) issues.push("PHONE_CONFLICT");
  }
  if (phone) {
    const p = normalizePhone(phone);
    normalized = p.normalized;
    if (!p.valid) issues.push("INVALID_PHONE");
  } else issues.push("MISSING_PHONE");

  if (!name) issues.push("MISSING_NAME");
  if (!code) issues.push("MISSING_CODE");

  return { clientName: name, propertyCode: code, extraPropertyCodes: extraCodes, phoneRaw: phone, phoneNormalized: normalized, externalRef, issues };
}

export type AttendeeInput = { email?: string | null; organizer?: boolean | null; resource?: boolean | null };

export type Assignment =
  | { status: "AUTO"; consultantId: string; note: "QUEM_AGENDOU" | null }
  | { status: "NEEDS_REVIEW"; consultantId: null; note: "NENHUMA_CONSULTORA" | "MAIS_DE_UMA" | "CONVIDADOS_INACESSIVEIS" };

/**
 * Atribuição por correspondência exata do e-mail convidado com aliases de consultoras ativas.
 * Ignora organizador, cor, nome exibido e criador do evento. Status de resposta não importa.
 */
export function assignConsultant(
  attendees: AttendeeInput[] | null | undefined,
  attendeesOmitted: boolean,
  consultantAliases: Map<string, string>,
  /** consultora que criou/organiza o evento: vale quando nenhuma consultora foi convidada */
  scheduledById: string | null = null,
): Assignment {
  if (attendeesOmitted && !scheduledById) return { status: "NEEDS_REVIEW", consultantId: null, note: "CONVIDADOS_INACESSIVEIS" };
  const found = new Set<string>();
  for (const a of attendees ?? []) {
    if (!a.email || a.resource || a.organizer) continue;
    const userId = consultantAliases.get(normalizeEmail(a.email));
    if (userId) found.add(userId);
  }
  if (found.size === 1) return { status: "AUTO", consultantId: [...found][0], note: null };
  // a consultora marcou na própria agenda e convidou só o pré-atendimento/gestão: a visita é dela
  if (found.size === 0 && scheduledById) return { status: "AUTO", consultantId: scheduledById, note: "QUEM_AGENDOU" };
  return { status: "NEEDS_REVIEW", consultantId: null, note: found.size === 0 ? "NENHUMA_CONSULTORA" : "MAIS_DE_UMA" };
}

export const ISSUE_LABEL: Record<ParseIssue, string> = {
  MISSING_NAME: "Nome do cliente ausente",
  MISSING_CODE: "Código do imóvel ausente",
  MISSING_PHONE: "Telefone ausente",
  INVALID_PHONE: "Telefone inválido",
  PHONE_CONFLICT: "Telefone diferente entre título e descrição",
  CODE_CONFLICT: "Código diferente entre título e descrição",
};

export const ASSIGNMENT_NOTE_LABEL: Record<string, string> = {
  NENHUMA_CONSULTORA: "Nenhuma consultora reconhecida entre os convidados",
  QUEM_AGENDOU: "Consultora que criou o evento na agenda",
  PRE_ATENDIMENTO: "Agendada pelo pré-atendimento no app",
  MAIS_DE_UMA: "Mais de uma consultora entre os convidados",
  CONVIDADOS_INACESSIVEIS: "Lista de convidados inacessível",
  CORRECAO_MANUAL: "Atribuição corrigida manualmente",
  CADASTRO_MANUAL: "Cadastro manual",
};

/** Tira um código de imóvel do título ("cod 111;222;333" → "cod 111;333"). Os demais textos ficam iguais. */
export function removeCodeFromTitle(title: string, code: string): string {
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title
    .replace(new RegExp(`([;,]\\s*)${esc}(?=[\\s;,)]|$)`, "g"), "")
    .replace(new RegExp(`(?<=[\\s(:#.])${esc}\\s*[;,]\\s*`, "g"), "")
    .replace(/\s{2,}/g, " ");
}
