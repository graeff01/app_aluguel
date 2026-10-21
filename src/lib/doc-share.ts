/** Mensagem do WhatsApp com o link de documentos (a pessoa da equipe é quem envia; nada é automático). */
export function docShareMessage(p: { clientName: string; sender: string; url: string; verify: "CPF" | "PHONE" | null }) {
  const first = p.clientName.trim().split(/\s+/)[0] || "";
  const me = p.sender.trim().split(/\s+/)[0];
  return [
    `Olá${first ? `, ${first}` : ""}! Aqui é ${me}, da Auxiliadora Predial.`,
    "Para dar andamento à sua locação, envie seus documentos por este link seguro. É rápido e dá para tirar as fotos pelo próprio celular:",
    p.url,
    "Antes de enviar, você confirma alguns números do seu CPF ou celular. O link vale por 7 dias.",
  ].join("\n\n");
}

export function whatsappUrl(phoneE164: string | null | undefined, text: string) {
  if (!phoneE164) return null;
  return `https://wa.me/${phoneE164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
