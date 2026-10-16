/** Fluxo pós-visita (situações da agência, as mesmas das planilhas). Sem dependência de servidor: usado nas telas também. */
export const DEAL_STAGES = ["NEGOTIATION", "OWNER_PENDING", "KYC_SENT", "ANALYSIS", "DOCS", "CONTRACT", "SIGNED", "POSSESSION"] as const;
export type Stage = (typeof DEAL_STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  NEGOTIATION: "Em negociação",
  OWNER_PENDING: "Aguardando o proprietário",
  KYC_SENT: "KYC enviado",
  ANALYSIS: "Pré-análise / Em análise",
  DOCS: "Aguardando documentação",
  CONTRACT: "Contrato liberado / enviado",
  SIGNED: "Contrato assinado",
  POSSESSION: "Posse",
};

/** O que a etapa registra (texto de ajuda na tela). */
export const STAGE_HINT: Record<Stage, string> = {
  NEGOTIATION: "Cliente quer seguir: valor proposto e garantia pretendida.",
  OWNER_PENDING: "Proposta enviada ao proprietário.",
  KYC_SENT: "Proprietário aceitou: valor final. Link de cadastro (KYC) enviado ao cliente.",
  ANALYSIS: "Pré-análise / análise de crédito em andamento.",
  DOCS: "Análise aprovada: garantia definida. Pedido da documentação.",
  CONTRACT: "Pedido ao ADM e vistoria, se houver: contrato liberado e enviado.",
  SIGNED: "Contrato assinado: entra no VGL e o marketing é avisado.",
  POSSESSION: "Entrega das chaves (antifraude: só o titular retira).",
};

export const FOLLOW_UP_LABEL = "Em acompanhamento";
export const FELL_LABEL = "Caiu";
export const DEAL_TYPE_LABEL = { LEASE: "Locação", INTERMEDIATION: "Só intermediação" } as const;

export const stageIndex = (s: Stage | null | undefined) => (s ? DEAL_STAGES.indexOf(s) : -1);

/** Situação → status usado nos indicadores de sempre (acompanhamento / documentação / fechada). */
export function coarseStatus(stage: Stage | null): "FOLLOW_UP" | "DOCS_REVIEW" | "CLOSED_WON" {
  if (stage === "SIGNED" || stage === "POSSESSION") return "CLOSED_WON";
  if (stage === "DOCS" || stage === "CONTRACT") return "DOCS_REVIEW";
  return "FOLLOW_UP";
}

export const situationLabel = (o: { stage: Stage | null; status: string }) => (o.status === "LOST" ? FELL_LABEL : o.stage ? STAGE_LABEL[o.stage] : FOLLOW_UP_LABEL);
