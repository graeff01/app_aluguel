/**
 * "O que mudou": novidades de cada atualização, por perfil. A mais nova primeiro.
 * A cada atualização relevante, acrescente uma entrada no topo (id = data YYYY-MM-DD, mais um sufixo se houver duas no dia).
 * Cada pessoa vê uma vez, no próximo acesso, só o que vale para o perfil dela.
 */
export type Audience = "CONSULTANT" | "PRE_SERVICE" | "MANAGER" | "ADMIN" | "MARKETING";
export type Change = { text: string; who: Audience[]; href?: string };
export type ChangelogEntry = { id: string; title: string; changes: Change[] };

const ALL: Audience[] = ["CONSULTANT", "PRE_SERVICE", "MANAGER", "MARKETING"];
const STAFF: Audience[] = ["PRE_SERVICE", "MANAGER"];

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-10-19",
    title: "Agenda Google no app, fotos para o marketing e central de ajuda",
    changes: [
      { text: "Central de ajuda: toque no “?” no canto da tela para ver o passo a passo da tela em que você está. A ajuda completa fica no menu da conta.", who: ALL, href: "/ajuda" },
      { text: "Agenda Google dentro do app: dia, semana e mês como no Google. Arraste para mudar o horário, clique num horário vazio para criar visita ou evento, e tudo vai na hora para o Google.", who: ["PRE_SERVICE"], href: "/agenda-google" },
      { text: "Cancelar a visita pelo app não apaga mais o evento: ele vai para as 22h do mesmo dia e continua na agenda. “Desfazer” volta para o horário original.", who: STAFF },
      { text: "Painel da equipe: botão do pré-atendimento ao lado das consultoras, com as visitas agendadas por ela, comparecimento, cancelamentos e pré-análises.", who: ["MANAGER"], href: "/painel" },
      { text: "Fotos do anúncio guardadas em cada locação: baixe uma a uma ou todas (.zip) para usar no Canva. Ficam aqui mesmo depois que o imóvel sai do site.", who: ["MARKETING", "MANAGER"], href: "/marketing" },
      { text: "Aviso 1 dia antes de a conexão com a agenda Google vencer (modo teste do Google), para reconectar a tempo.", who: ["ADMIN"], href: "/admin/google" },
    ],
  },
  {
    id: "2026-10-17",
    title: "Negócios no celular e motivo do cancelamento",
    changes: [
      { text: "No celular, o cartão “Negócios em andamento” abre seus negócios: mude a etapa do cliente direto pelo celular.", who: ["CONSULTANT"], href: "/oportunidades" },
      { text: "Na agenda, toda visita cancelada mostra quem cancelou (a consultora ou a agenda Google). Se não tiver motivo, use “Informar motivo”.", who: STAFF, href: "/agenda-do-dia" },
    ],
  },
  {
    id: "2026-10-16",
    title: "Fluxo depois da visita até a posse",
    changes: [
      { text: "Andamento: o negócio segue por etapas (negociação, proprietário, KYC, análise, documentos, contrato, assinado, posse). Cada etapa pede só o que ela registra.", who: ["CONSULTANT", "MANAGER"], href: "/oportunidades" },
      { text: "Negócio que caiu: escolha a etapa e o motivo. Parado há muitos dias: o app avisa.", who: ["CONSULTANT", "MANAGER"] },
      { text: "Funil do mês e VGL (valor dos contratos assinados) na tela Andamento.", who: ["MANAGER"], href: "/oportunidades" },
      { text: "Agendar pelo app cria o evento no Google já no padrão, com a consultora convidada. Mudanças feitas no app vão para o Google.", who: ["PRE_SERVICE"], href: "/agenda-do-dia/nova" },
      { text: "Pré-análise pendente mostra o que falta; ao anexar, volta para a consultora. Depois da visita, mensagens prontas para o cliente no WhatsApp.", who: ["CONSULTANT", "PRE_SERVICE"] },
    ],
  },
];

export const LATEST_CHANGE = CHANGELOG[0].id;

const sees = (role: string, c: Change) => c.who.includes(role as Audience) || (role === "ADMIN" && c.who.includes("MANAGER"));

/** A entrada só com o que vale para o perfil (null se nada vale). */
export function entryFor(role: string, e: ChangelogEntry): ChangelogEntry | null {
  const changes = e.changes.filter((c) => sees(role, c));
  return changes.length ? { ...e, changes } : null;
}

/** Novidades ainda não vistas (até 3 atualizações). Quem nunca viu: só a mais recente. */
export function unseenChanges(role: string, seen: string | null): ChangelogEntry[] {
  const list = (seen ? CHANGELOG.filter((e) => e.id > seen) : CHANGELOG.slice(0, 1)).map((e) => entryFor(role, e)).filter((e): e is ChangelogEntry => !!e);
  return list.slice(0, 3);
}

export const changeDate = (id: string) => `${id.slice(8, 10)}/${id.slice(5, 7)}/${id.slice(0, 4)}`;
