/** Listas editáveis pela gestão (tabela Reason, separadas por tipo). */
export const REASON_GROUPS = [
  { kind: "VISIT_NEGATIVE", title: "Motivos de visita negativa", placeholder: "Novo motivo" },
  { kind: "OPPORTUNITY_LOST", title: "Motivos de perda posterior", placeholder: "Novo motivo" },
  { kind: "VISIT_CANCEL", title: "Motivos de cancelamento de visita (pré-atendimento)", placeholder: "Novo motivo" },
  { kind: "GUARANTEE", title: "Garantias da locação (pré-análise)", placeholder: "Nova garantia" },
  { kind: "LEASE_HIGHLIGHT", title: "Diferenciais da locação (aviso ao marketing)", placeholder: "Novo diferencial" },
  { kind: "LEASE_AGENT", title: "Agenciadores", placeholder: "Nome do agenciador" },
] as const;

export const REASON_KINDS: string[] = REASON_GROUPS.map((g) => g.kind);

export const REASON_USAGE = { visits: true, canceledVisits: true, opportunities: true, preAnalyses: true, leasePosts: true } as const;
export const reasonUsage = (c: { visits: number; canceledVisits: number; opportunities: number; preAnalyses: number; leasePosts: number }) =>
  c.visits + c.canceledVisits + c.opportunities + c.preAnalyses + c.leasePosts;
