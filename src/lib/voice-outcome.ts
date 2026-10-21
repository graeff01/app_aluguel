/**
 * Registro por voz: interpreta o que a consultora falou depois da visita e sugere o preenchimento.
 * Regras fixas, sem IA e sem enviar nada para fora: o texto vem do ditado do próprio celular.
 * A consultora sempre confere antes de salvar.
 */
import { normalizeText } from "./text";

export type VoiceStatus = "DONE" | "NO_SHOW" | "CANCELED" | "RESCHEDULED";
export type VoiceEvaluation = "POSITIVE" | "NEGATIVE" | "UNDECIDED";

export type VoiceResult = {
  status: VoiceStatus | null;
  evaluation: VoiceEvaluation | null;
  reasonId: string | null;
  /** dias até o retorno ("sexta", "amanhã", "semana que vem") */
  followUpDays: number | null;
  /** rótulo do retorno para mostrar ("sexta-feira", "amanhã") */
  followUpLabel: string | null;
  /** observação pronta (frase com maiúscula e ponto final) */
  note: string;
};

const has = (t: string, re: RegExp) => re.test(t);

// ordem importa: "não gostou" contém "gostou"
const NO_SHOW = /\b(nao (com)?pareceu|nao veio|nao apareceu|nao foi|furou|deu bolo|nao atendeu|ninguem apareceu|faltou)\b/;
const CANCELED = /\bcancel(ou|ada|ado|aram|ei|amos)\b/;
const RESCHEDULED = /\b(remarc\w*|reagend\w*|mudou o horario|trocou o horario|passou para outro dia)\b/;
const NEGATIVE =
  /\b(nao gostou|nao curtiu|nao quer|nao quis|nao vai (fechar|ficar|alugar)|desistiu|descartou|reprovou|nao serve|nao atende|nao agradou|nao se interessou|nao tem interesse|achou (muito )?(caro|pequeno|apertado|longe|ruim|feio|velho|escuro)|nao (e|era) o que (ele|ela|eles|elas)? ?procura\w*)\b/;
const STRONG_POSITIVE =
  /\b(quer (fechar|alugar|ficar|avancar|seguir)|vai (mandar|enviar|passar) (a |os |as )?(documenta\w*|documentos?|docs?)|(fazer|mandar|vai fazer) (uma )?proposta|fechar negocio|vai fechar|quer o imovel|ja quer)\b/;
const POSITIVE = /\b(gostou|adorou|amou|curtiu|aprovou|encantou|ficou encantad\w|achou (lindo|otimo|perfeito|bom|bonito))\b/;
const UNDECIDED =
  /\b(vai pensar|pensar|decidir|conversar com|falar com|ver com|consultar|comparar|outros imoveis|da(r)? (um )?retorno|me liga|vai ligar|ficou de|em duvida|indecis\w|talvez|nao sabe)\b/;

/** palavras faladas → palavras que costumam aparecer no rótulo do motivo cadastrado */
const REASON_HINTS: { spoken: RegExp; label: string[] }[] = [
  { spoken: /\b(caro|valor|preco|orcamento|condominio|iptu|aluguel alto|acima|custo|salgado)\b/, label: ["preco", "valor", "caro", "orcamento", "custo", "condominio"] },
  { spoken: /\b(localiza\w*|longe|bairro|regiao|rua|barulh\w*|transporte|seguranca|perigos\w*|distante)\b/, label: ["localiza", "bairro", "regiao", "distan"] },
  { spoken: /\b(pequen\w*|apertad\w*|tamanho|espaco|quartos?|metragem|area)\b/, label: ["tamanho", "pequen", "espaco", "metragem"] },
  { spoken: /\b(conserva\w*|estado|sujo|mofo|umidade|velho|reforma|desgastad\w*|estragad\w*|mal cuidad\w*)\b/, label: ["conserva", "estado", "reforma"] },
  { spoken: /\b(outro imovel|preferiu outro|ja alugou|achou outro|fechou com outr\w*)\b/, label: ["outro imovel", "preferiu", "concorr"] },
  { spoken: /\b(fiador|garantia|caucao|deposito|seguro fianca|credpago|analise de credito|documentacao exigida)\b/, label: ["garantia", "condic", "fiador"] },
  { spoken: /\b(pet|cachorro|gato|animal|animais)\b/, label: ["pet", "animal", "caracteristic"] },
  { spoken: /\b(garagem|vaga|estacionamento)\b/, label: ["garagem", "vaga", "caracteristic"] },
  { spoken: /\b(luz|iluminacao|escuro|sol|ventila\w*|elevador|andar|escada|vista|cozinha|banheiro|planta)\b/, label: ["ilumina", "caracteristic"] },
];

const WEEKDAYS: [RegExp, number, string][] = [
  [/\bdomingo\b/, 0, "domingo"],
  [/\bsegunda\b/, 1, "segunda-feira"],
  [/\bterca\b/, 2, "terça-feira"],
  [/\bquarta\b/, 3, "quarta-feira"],
  [/\bquinta\b/, 4, "quinta-feira"],
  [/\bsexta\b/, 5, "sexta-feira"],
  [/\bsabado\b/, 6, "sábado"],
];

const NUMBERS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, quinze: 15 };

/** Retorno combinado: "amanhã", "sexta", "semana que vem", "em 3 dias". `weekday` = dia da semana de hoje (0 = domingo). */
export function followUpFrom(t: string, weekday: number): { days: number; label: string } | null {
  if (has(t, /\bdepois de amanha\b/)) return { days: 2, label: "depois de amanhã" };
  if (has(t, /\bamanha\b/)) return { days: 1, label: "amanhã" };
  const n = t.match(/\b(?:em|daqui a?|dentro de)\s+(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze)\s+dias?\b/);
  if (n) {
    const d = Number(n[1]) || NUMBERS[n[1]];
    if (d >= 1 && d <= 60) return { days: d, label: d === 1 ? "amanhã" : `em ${d} dias` };
  }
  if (has(t, /\b(semana que vem|proxima semana|semana seguinte)\b/)) return { days: 7, label: "semana que vem" };
  if (has(t, /\b(fim de semana|final de semana)\b/)) {
    const d = (6 - weekday + 7) % 7 || 7;
    return { days: d, label: "fim de semana" };
  }
  for (const [re, wd, label] of WEEKDAYS) {
    if (has(t, re)) {
      const d = (wd - weekday + 7) % 7 || 7;
      return { days: d, label };
    }
  }
  return null;
}

function pickReason(t: string, reasons: { id: string; label: string }[]): string | null {
  const norm = reasons.map((r) => ({ id: r.id, label: normalizeText(r.label) }));
  for (const h of REASON_HINTS) {
    if (!h.spoken.test(t)) continue;
    const r = norm.find((x) => h.label.some((w) => x.label.includes(w)));
    if (r) return r.id;
  }
  // a consultora falou o próprio nome do motivo ("motivo localização")
  for (const r of norm) {
    const words = r.label.split(/\s+/).filter((w) => w.length >= 5);
    if (words.some((w) => t.includes(w))) return r.id;
  }
  return null;
}

/** Frase limpa para a observação: maiúscula no início e ponto final. */
export function tidySentence(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  const cap = s[0].toLocaleUpperCase("pt-BR") + s.slice(1);
  return /[.!?…]$/.test(cap) ? cap : `${cap}.`;
}

export function interpretSpeech(raw: string, reasons: { id: string; label: string }[], weekday: number): VoiceResult {
  const t = normalizeText(raw);
  const out: VoiceResult = { status: null, evaluation: null, reasonId: null, followUpDays: null, followUpLabel: null, note: tidySentence(raw) };
  if (!t) return out;

  if (has(t, NO_SHOW)) out.status = "NO_SHOW";
  else if (has(t, CANCELED)) out.status = "CANCELED";
  else if (has(t, RESCHEDULED)) out.status = "RESCHEDULED";
  else if (has(t, NEGATIVE) || has(t, STRONG_POSITIVE) || has(t, POSITIVE) || has(t, UNDECIDED)) out.status = "DONE";

  if (out.status === "DONE") {
    if (has(t, NEGATIVE)) out.evaluation = "NEGATIVE";
    else if (has(t, STRONG_POSITIVE)) out.evaluation = "POSITIVE";
    // "gostou, mas vai conversar com o marido" = ainda decidindo
    else if (has(t, UNDECIDED)) out.evaluation = "UNDECIDED";
    else if (has(t, POSITIVE)) out.evaluation = "POSITIVE";
  }
  if (out.evaluation === "NEGATIVE") out.reasonId = pickReason(t, reasons);
  if (out.evaluation === "UNDECIDED") {
    const f = followUpFrom(t, weekday);
    if (f) {
      out.followUpDays = f.days;
      out.followUpLabel = f.label;
    }
  }
  return out;
}
