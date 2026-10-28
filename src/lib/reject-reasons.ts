/** Motivos de "fora do perfil" para as opções do site (usado na tela e no servidor). */
export const REJECT_REASONS = {
  PRICE: "Valor acima do que pode pagar",
  AREA: "Bairro que o cliente não quer",
  TYPE: "Tipo de imóvel diferente",
  SMALL: "Pequeno / poucos quartos",
  GARAGE: "Precisa de garagem",
  OFFERED: "Já foi oferecido ao cliente",
  OTHER: "Outro motivo",
} as const;
export type RejectReason = keyof typeof REJECT_REASONS;
