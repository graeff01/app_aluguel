/** Mensagem de WhatsApp com opções de imóveis para o cliente (Radar e Clientes em busca). Sem dependência de servidor. */
export type OptionItem = { code: string; category: string | null; neighborhood: string | null; bedrooms: number | null; totalCents: number | null; rentCents: number | null; url: string };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function optionsMessage(clientName: string, senderName: string, items: OptionItem[]) {
  const first = clientName.trim().split(/\s+/)[0] ?? "";
  const me = senderName.trim().split(/\s+/)[0] ?? "";
  const lines = items.map((it, i) => {
    const price = it.totalCents ?? it.rentCents;
    const desc = [it.category, it.neighborhood, it.bedrooms ? `${it.bedrooms} quarto${it.bedrooms > 1 ? "s" : ""}` : null, price ? `${brl(price)}${it.totalCents ? " no total" : ""}` : null].filter(Boolean).join(" · ");
    return `${i + 1}) ${desc}\n${it.url}`;
  });
  const n = items.length;
  return [
    `Oi${first ? `, ${first}` : ""}! Aqui é ${me ? `a ${me}, ` : ""}da Auxiliadora Predial. Separei ${n === 1 ? "uma opção" : `${n} opções`} com o perfil que você procura:`,
    "",
    lines.join("\n\n"),
    "",
    `${n === 1 ? "Gostou?" : "Gostou de alguma?"} Posso agendar a visita para você 😊`,
  ].join("\n");
}

export const whatsappUrl = (phoneE164: string, text: string) => `https://wa.me/${phoneE164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
