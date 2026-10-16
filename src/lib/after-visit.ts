/** Mensagem pronta para depois da visita, conforme o resultado (WhatsApp aberto pela consultora; nada é enviado sozinho). */
import { buildConfirmMessage, whatsappUrl } from "./confirm";

type Settings = { msgAfterPositive: string; msgAfterUndecided: string; msgAfterNegative: string; msgAfterNoShow: string };
type V = { status: string; evaluation: string | null; phoneNormalized: string | null; clientName: string | null; propertyCode: string | null; scheduledStart: Date; consultant?: { name: string } | null; property?: { neighborhood: string | null } | null };

export const AFTER_VISIT_LABEL = {
  positive: "Pedir documentos",
  undecided: "Mensagem de retorno",
  negative: "Oferecer outras opções",
  noShow: "Propor remarcar",
} as const;

export function afterVisitKind(v: Pick<V, "status" | "evaluation">): keyof typeof AFTER_VISIT_LABEL | null {
  if (v.status === "NO_SHOW") return "noShow";
  if (v.status !== "DONE") return null;
  return v.evaluation === "POSITIVE" ? "positive" : v.evaluation === "UNDECIDED" ? "undecided" : v.evaluation === "NEGATIVE" ? "negative" : null;
}

/** Link do WhatsApp com a mensagem do resultado; null quando não se aplica ou não há telefone válido. */
export function afterVisitLink(s: Settings, v: V, now = new Date()) {
  const kind = afterVisitKind(v);
  if (!kind || !v.phoneNormalized) return null;
  const template = { positive: s.msgAfterPositive, undecided: s.msgAfterUndecided, negative: s.msgAfterNegative, noShow: s.msgAfterNoShow }[kind];
  const text = buildConfirmMessage(template, { clientName: v.clientName, consultantName: v.consultant?.name ?? null, scheduledStart: v.scheduledStart, propertyCode: v.propertyCode, neighborhood: v.property?.neighborhood ?? null }, now);
  return { kind, label: AFTER_VISIT_LABEL[kind], url: whatsappUrl(v.phoneNormalized, text), text };
}
