export const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Agendada",
  DONE: "Realizada",
  NO_SHOW: "Cliente não compareceu",
  CANCELED: "Cancelada",
  RESCHEDULED: "Remarcada",
};
export const EVALUATION_LABEL: Record<string, string> = {
  POSITIVE: "Positiva",
  NEGATIVE: "Negativa",
  UNDECIDED: "Ainda decidindo",
};
export const OPP_STATUS_LABEL: Record<string, string> = {
  FOLLOW_UP: "Em acompanhamento",
  DOCS_REVIEW: "Documentação em análise",
  CLOSED_WON: "Locação fechada",
  LOST: "Perdida",
};
export const ROLE_LABEL: Record<string, string> = { ADMIN: "Administrador(a)", MANAGER: "Gestora", CONSULTANT: "Consultora" };
export const CONFLICT_LABEL: Record<string, string> = {
  CANCELED_IN_GOOGLE: "Cancelada/excluída no Google após resultado registrado",
  DELETED_IN_GOOGLE: "Excluída no Google após resultado registrado",
  NO_LONGER_VISIT: "Evento deixou de parecer visita (título alterado)",
  CHANGED_AFTER_CONCLUSION: "Dados alterados no Google após a conclusão",
  POSSIBLE_RECREATION: "Possível recriação de evento anterior",
};
export const MATCH_LABEL: Record<string, string> = {
  NEW_CONFIRMED: "Cliente novo (telefone validado)",
  PHONE_MATCH: "Mesmo telefone e nome compatível",
  SUGGESTED: "Vínculo a confirmar",
  NO_PHONE: "Identificação pendente (sem telefone válido)",
  CONFIRMED_MANUAL: "Vínculo confirmado manualmente",
};
