/** Fluxo pós-visita (situações da agência, as mesmas das planilhas). Sem dependência de servidor: usado nas telas também. */
export const DEAL_STAGES = ["NEGOTIATION", "OWNER_PENDING", "PRE_ANALYSIS", "KYC_SENT", "ANALYSIS", "APPROVED", "INSPECTION", "CONTRACT", "SIGNED", "POSSESSION"] as const;
export type Stage = (typeof DEAL_STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  NEGOTIATION: "Em negociação",
  OWNER_PENDING: "Aguardando o proprietário",
  PRE_ANALYSIS: "Pré-análise",
  KYC_SENT: "KYC enviado / aguardando documentação",
  ANALYSIS: "Em análise com o crédito",
  APPROVED: "Cadastro aprovado",
  INSPECTION: "Aguardando vistoria / contrato ADM",
  CONTRACT: "Contrato liberado / enviado",
  SIGNED: "Contrato assinado",
  POSSESSION: "Posse",
};

/** O que a etapa registra (texto de ajuda na tela). */
export const STAGE_HINT: Record<Stage, string> = {
  NEGOTIATION: "Cliente quer seguir: valor proposto e garantia pretendida.",
  OWNER_PENDING: "Proposta enviada ao proprietário.",
  PRE_ANALYSIS: "Proprietário aceitou: valor final. Pré-análise do cliente em andamento.",
  KYC_SENT: "Link de cadastro (KYC) enviado ao cliente; aguardando a documentação.",
  ANALYSIS: "Cadastro completo: análise com o crédito em andamento.",
  APPROVED: "Crédito aprovado: garantia definida.",
  INSPECTION: "Pedido do contrato ao ADM e vistoria, se houver.",
  CONTRACT: "Contrato liberado pelo ADM e enviado ao cliente.",
  SIGNED: "Contrato assinado: entra no VGL e o marketing é avisado.",
  POSSESSION: "Entrega das chaves (antifraude: só o titular retira).",
};

export const FOLLOW_UP_LABEL = "Em acompanhamento";
export const FELL_LABEL = "Caiu";
/** Quadro: o que caiu se divide em quem não seguiu depois da visita e quem desistiu durante a contratação. */
export const FELL_VISIT_LABEL = "Caiu após a visita";
export const FELL_DEAL_LABEL = "Desistiu na contratação";
/** Caiu durante o fluxo (tinha etapa) = desistência da contratação; senão, não seguiu depois da visita. */
export const fellInDeal = (o: { lostStage: string | null }) => !!o.lostStage;
export const DEAL_TYPE_LABEL = { LEASE: "Locação", INTERMEDIATION: "Só intermediação" } as const;

export const stageIndex = (s: Stage | null | undefined) => (s ? DEAL_STAGES.indexOf(s) : -1);

/** Situação → status usado nos indicadores de sempre (acompanhamento / documentação / fechada). */
export function coarseStatus(stage: Stage | null): "FOLLOW_UP" | "DOCS_REVIEW" | "CLOSED_WON" {
  if (stage === "SIGNED" || stage === "POSSESSION") return "CLOSED_WON";
  if (stage === "APPROVED" || stage === "INSPECTION" || stage === "CONTRACT") return "DOCS_REVIEW";
  return "FOLLOW_UP";
}

export const situationLabel = (o: { stage: string | null; status: string }) => (o.status === "LOST" ? FELL_LABEL : (o.stage && STAGE_LABEL[o.stage as Stage]) || FOLLOW_UP_LABEL);
