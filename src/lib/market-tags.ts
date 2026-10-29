/** Leitura de mercado da captação (pedido e perfil): opções rápidas, usadas na tela e no servidor. */
export const MARKET_TAGS = {
  ABOVE: "Tem, mas acima desse valor",
  FEWER_ROOMS: "Nesse valor, só com menos quartos",
  NEARBY: "Tem em bairro próximo",
  HARD: "Difícil nesse valor",
  RARE: "Raro no mercado",
  SEARCHING: "Possível: estamos buscando",
} as const;
export type MarketTag = keyof typeof MARKET_TAGS;
/** tom da etiqueta na tela */
export const MARKET_TONE: Record<MarketTag, "bad" | "warn" | "good"> = { ABOVE: "warn", FEWER_ROOMS: "warn", NEARBY: "warn", HARD: "bad", RARE: "bad", SEARCHING: "good" };
