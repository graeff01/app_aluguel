/**
 * Respostas rápidas para a observação: um toque insere o texto, que continua editável.
 * A observação segue obrigatória — as frases só aceleram a digitação.
 */
type Key = "POSITIVE" | "NEGATIVE" | "UNDECIDED" | "NO_SHOW" | "CANCELED" | "RESCHEDULED";

export const QUICK_NOTES: Record<Key, string[]> = {
  POSITIVE: ["Gostou do imóvel e quer avançar.", "Vai enviar a documentação.", "Quer fazer uma proposta.", "Vai trazer a família para ver novamente."],
  NEGATIVE: ["Achou o valor total alto.", "Localização não atende.", "Imóvel pequeno para a necessidade.", "Não gostou da conservação.", "Preferiu outro imóvel."],
  UNDECIDED: ["Vai pensar e dar retorno.", "Quer comparar com outros imóveis.", "Vai conversar com a família.", "Vai trazer alguém para ver."],
  NO_SHOW: ["Não compareceu e não atendeu o telefone.", "Avisou que não poderia vir.", "Não compareceu; vou tentar remarcar."],
  CANCELED: ["Cliente cancelou a visita.", "Imóvel ficou indisponível.", "Cancelada pela imobiliária."],
  RESCHEDULED: ["Cliente pediu para remarcar.", "Remarcada por conflito de horário."],
};

export function quickNotesFor(status: string | null, evaluation: string | null): string[] {
  if (status === "DONE") return evaluation ? QUICK_NOTES[evaluation as Key] ?? [] : [];
  return status ? QUICK_NOTES[status as Key] ?? [] : [];
}

/** Acrescenta a frase ao texto existente sem duplicar. */
export function appendNote(current: string, phrase: string) {
  const t = current.trimEnd();
  if (t.includes(phrase)) return current;
  if (!t) return phrase + " ";
  return `${t}${/[.!?]$/.test(t) ? "" : "."} ${phrase} `;
}
