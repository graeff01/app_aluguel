/**
 * "O que mudou": novidades de cada atualização, por perfil. A mais nova primeiro.
 * A cada atualização relevante, acrescente uma entrada no topo (id = data YYYY-MM-DD, mais um sufixo se houver duas no dia).
 * Cada pessoa vê uma vez, no próximo acesso, só o que vale para o perfil dela.
 */
export type Audience = "CONSULTANT" | "PRE_SERVICE" | "MANAGER" | "ADMIN" | "MARKETING" | "CAPTURE";
export type Change = { text: string; who: Audience[]; href?: string };
export type ChangelogEntry = { id: string; title: string; changes: Change[] };

const ALL: Audience[] = ["CONSULTANT", "PRE_SERVICE", "MANAGER", "MARKETING"];
const STAFF: Audience[] = ["PRE_SERVICE", "MANAGER"];

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-10-29-c",
    title: "Avisos que não se perdem",
    changes: [
      { text: "Novo sino no topo do app: tudo o que a captação atualiza (achou imóvel, parecer, leitura de mercado) chega como aviso e fica numa faixa em destaque até você abrir. A lista completa fica em “Avisos”.", who: ["PRE_SERVICE", "CONSULTANT", "MANAGER"], href: "/avisos" },
      { text: "Pedido novo, atualizado, encerrado ou reaberto pelo atendimento chega como aviso no sino e na faixa do topo, e fica até você abrir. Pedido encerrado: pode parar a busca.", who: ["CAPTURE"], href: "/avisos" },
    ],
  },
  {
    id: "2026-10-29-b",
    title: "Leitura de mercado da captação",
    changes: [
      { text: "Em cada pedido, “Escrever parecer”: diga o que o mercado oferece (“tem, mas acima desse valor”, “nesse valor, só com menos quartos”…), o valor realista e uma observação. O pré-atendimento é avisado na hora.", who: ["CAPTURE", "MANAGER"], href: "/demanda/pedidos" },
      { text: "No Mapa da demanda, escreva a leitura de cada perfil (bairro + tipo). Ela entra no resumo do WhatsApp e aparece para quem atende clientes com esse perfil.", who: ["CAPTURE", "MANAGER"], href: "/demanda" },
      { text: "Parecer da captação no pedido do radar: o que o mercado oferece para o perfil, para usar na conversa com o cliente (ajustar valor, quartos ou bairro). Você recebe um aviso quando chega.", who: ["PRE_SERVICE"], href: "/radar" },
      { text: "Clientes em busca: quando a captação tiver uma leitura de mercado para o bairro e tipo do cliente, ela aparece no cliente. Bom argumento para ajustar o valor ou os quartos.", who: ["CONSULTANT"], href: "/em-busca" },
    ],
  },
  {
    id: "2026-10-29",
    title: "Opção fora do perfil",
    changes: [
      { text: "Nas opções do site (Radar e Clientes em busca), “Fora do perfil”: diga o motivo (valor, bairro, tipo, tamanho, garagem, já oferecido…) e o imóvel sai das sugestões daquele cliente. O motivo ajusta as próximas: valor alto baixa o teto, bairro e tipo deixam de aparecer, “pequeno” pede mais quartos.", who: ["PRE_SERVICE", "CONSULTANT", "MANAGER"] },
    ],
  },
  {
    id: "2026-10-28-c",
    title: "Perfil Captação",
    changes: [
      { text: "Bem-vindo(a) ao app! Em “Mapa da demanda” você vê o que os clientes mais procuram e onde falta imóvel no site. Em “Pedidos”, cada pedido do pré-atendimento com o perfil (sem dados pessoais).", who: ["CAPTURE"], href: "/demanda" },
      { text: "Achou um imóvel para um pedido? Toque em “Achei imóvel” e informe o código: o pré-atendimento é avisado na hora para oferecer ao cliente.", who: ["CAPTURE"], href: "/demanda/pedidos" },
      { text: "Demonstração da captação sem login, com dados fictícios, para mostrar a quem ainda não tem acesso: endereço do app + /demo/captacao. As sugestões deixadas lá aparecem em “Sugestões (demo)”.", who: ["MANAGER"], href: "/config/sugestoes" },
      { text: "Novo perfil “Captação” em Usuários: vê só o Mapa da demanda e os pedidos do radar (sem nome nem telefone dos clientes) e indica os imóveis que achar.", who: ["MANAGER"], href: "/config/usuarios" },
      { text: "Quando a captação achar um imóvel para um pedido do radar, você recebe um aviso e o pedido vai para “Cobrar hoje”.", who: ["PRE_SERVICE"], href: "/radar" },
    ],
  },
  {
    id: "2026-10-28-b",
    title: "O app de olho no site da Auxiliadora",
    changes: [
      { text: "Mapa da demanda: o que os clientes procuram e não encontram (bairros, tipo, quartos e valor), cruzado com o que existe hoje no site. Mostra onde falta imóvel e monta o resumo pronto para mandar à captação.", who: ["MANAGER"], href: "/demanda" },
      { text: "Radar vigiando o site: todo dia o app refaz a busca de cada pedido e avisa quando entra um imóvel novo com o perfil (aba “Novos no site”).", who: STAFF, href: "/radar?aba=novos" },
      { text: "Opções do site direto para o cliente: escolha até 3 imóveis sugeridos e envie pelo WhatsApp com a mensagem pronta e os links. Fica registrado no histórico.", who: ["CONSULTANT", "PRE_SERVICE", "MANAGER"] },
      { text: "Clientes em busca: o app sugere imóveis do site com o perfil do cliente (sem os que ele já visitou) e avisa você quando aparece um novo.", who: ["CONSULTANT", "MANAGER"], href: "/em-busca" },
      { text: "Anúncio saiu do site antes da visita (pode ter sido alugado): o app avisa você e o pré-atendimento na véspera e no dia, com opções parecidas para trocar o imóvel.", who: ["CONSULTANT", "PRE_SERVICE", "MANAGER"] },
    ],
  },
  {
    id: "2026-10-28",
    title: "Radar de clientes",
    changes: [
      { text: "Radar de clientes: quando o cliente procura um perfil que não temos na base, registre o pedido que vai para a captação. O app lembra você de cobrar, guarda cada atualização e os imóveis achados, até o resultado final.", who: STAFF, href: "/radar" },
      { text: "No pedido do radar, “Opções parecidas no site”: o app busca no site da Auxiliadora imóveis disponíveis com o perfil (bairro, tipo, quartos e valor) para você já oferecer ao cliente.", who: STAFF, href: "/radar" },
    ],
  },
  {
    id: "2026-10-27",
    title: "Atualização sem mudar de etapa",
    changes: [
      { text: "No negócio, “Registrar atualização”: anote o andamento (ex.: o cliente vai decidir até sexta) sem mudar de etapa. Fica no histórico e o negócio deixa de contar como parado.", who: ["CONSULTANT", "MANAGER"], href: "/oportunidades" },
    ],
  },
  {
    id: "2026-10-26-b",
    title: "Andamento com as etapas novas",
    changes: [
      { text: "Andamento em 10 etapas: negociação, proprietário, pré-análise, KYC enviado / aguardando documentação, análise com o crédito, cadastro aprovado, vistoria / contrato ADM, contrato liberado, assinado e posse. Cada etapa pede só o que ela registra.", who: ["CONSULTANT", "MANAGER"], href: "/oportunidades" },
      { text: "No quadro, o que caiu agora fica separado: “Desistiu na contratação” (caiu durante as etapas) e “Caiu após a visita” (não seguiu depois da visita).", who: ["CONSULTANT", "MANAGER"], href: "/oportunidades?vista=quadro" },
    ],
  },
  {
    id: "2026-10-26",
    title: "Agenda do sistema: editar, trocar imóvel e quem agendou",
    changes: [
      { text: "Editar a visita na agenda do sistema: toque em “Editar” para mudar dia, horário, cliente, telefone, consultora ou adicionar outro imóvel. O evento na agenda Google é atualizado junto e a consultora é avisada.", who: STAFF, href: "/agenda-do-dia" },
      { text: "Agenda Google do app igual à sua agenda: visitas agendadas pelas consultoras aparecem em branco com borda colorida; as suas, preenchidas.", who: STAFF, href: "/agenda-google" },
      { text: "Cada visita mostra quem agendou (“Pré-atendimento” ou “Agendada pela consultora”), e dá para filtrar a agenda por isso.", who: STAFF, href: "/agenda-do-dia" },
      { text: "Imóvel indisponível e o cliente quer ver outro no mesmo horário? Na agenda do dia, toque em “Trocar imóvel”: o imóvel antigo fica como trocado (o cliente não aparece como cancelado) e a visita segue com o novo, também na agenda Google.", who: STAFF, href: "/agenda-do-dia" },
      { text: "Quando o pré-atendimento troca o imóvel de uma visita sua, você recebe um aviso com o novo código. O horário e o cliente continuam os mesmos.", who: ["CONSULTANT"] },
    ],
  },
  {
    id: "2026-10-23-b",
    title: "Propostas e pós-contrato",
    changes: [
      { text: "Nova proposta: registre o valor que o cliente propõe para o aluguel (nome, telefone, valor e imóvel). Vai para a consultora da vez, no mesmo rodízio da pré-análise.", who: ["PRE_SERVICE", "MANAGER"], href: "/propostas/nova" },
      { text: "Propostas: quando o pré-atendimento enviar uma proposta, leve ao proprietário e registre o andamento (enviada, contraproposta, aceita ou recusada). O pré-atendimento é avisado a cada passo.", who: ["CONSULTANT"], href: "/propostas" },
      { text: "O rodízio agora conta pré-análises e propostas juntas: quem recebeu a última de qualquer uma não é a próxima da vez.", who: STAFF },
      { text: "O pedido de documentos pelo link do cliente foi desligado. Os documentos já recebidos continuam na pré-análise e na visita. Para religar: Regras e app › Agenda e pré-análise.", who: ["MANAGER"] },
      { text: "Pós-contrato (por consultora, em Usuários): 5 dias depois do contrato assinado, lembrete para saber como está a nova moradia; 5 dias depois desse contato, lembrete para pedir uma indicação, com a mensagem pronta.", who: ["MANAGER"], href: "/config/usuarios" },
    ],
  },
  {
    id: "2026-10-23",
    title: "Ficha do cliente",
    changes: [
      { text: "Ficha do cliente: toque em “Ficha do cliente” na visita, no negócio, na busca ou na pré-análise e veja tudo o que já aconteceu com a pessoa numa linha do tempo — pré-análise, documentos, visitas, negócios e busca — e o que está em andamento agora.", who: ["CONSULTANT", "PRE_SERVICE", "MANAGER"] },
      { text: "A pré-análise passa a ficar ligada ao cadastro do cliente pelo telefone, mesmo antes da visita.", who: ["PRE_SERVICE", "MANAGER"] },
    ],
  },
  {
    id: "2026-10-22",
    title: "Clientes em busca",
    changes: [
      { text: "Cliente não gostou do imóvel, mas segue procurando? Ao registrar a visita negativa, marque “Cliente segue procurando outro imóvel”. Ele entra em “Clientes em busca” com lembrete para você oferecer outras opções — sem reabrir o negócio.", who: ["CONSULTANT"], href: "/em-busca" },
      { text: "Em cada cliente em busca: o que ele procura (valor, bairros, tipo, quartos, o que não quer), os imóveis que já viu, registrar contato e marcar visita em outro imóvel.", who: ["CONSULTANT", "MANAGER"], href: "/em-busca" },
      { text: "No negócio que caiu, botão “Cliente segue em busca”. Quando ele assina contrato com a gente, a busca termina sozinha.", who: ["CONSULTANT", "MANAGER"] },
      { text: "Gestão: quantos clientes estão em busca, quantos esfriaram, quantos alugaram conosco e quantos perdemos para outra imobiliária.", who: ["MANAGER"], href: "/em-busca" },
    ],
  },
  {
    id: "2026-10-21",
    title: "Registro por voz e documentos pelo link do cliente",
    changes: [
      { text: "Registrar falando: toque em “Falar como foi a visita” e conte do seu jeito (“gostou, mas vai falar com o marido e me liga na sexta”). O app marca o resultado, o motivo e o dia do retorno; você só confere e salva.", who: ["CONSULTANT"] },
      { text: "Documentos pelo link: o cliente recebe no WhatsApp um link seguro, confirma alguns números do CPF ou do celular e fotografa cada documento. Você é avisada quando ele conclui.", who: ["CONSULTANT", "PRE_SERVICE", "MANAGER"] },
      { text: "Cliente que gostou do imóvel aparece no topo de Minhas visitas com o botão “Pedir documentos”.", who: ["CONSULTANT"], href: "/minhas" },
      { text: "Na pré-análise, “Pedir documentos ao cliente” já sugere a lista pela garantia (fiador inclui os documentos do fiador).", who: ["PRE_SERVICE"], href: "/pre-analises" },
      { text: "Título de visita com uma letra errada (“Vista clt”) agora entra normalmente.", who: STAFF },
    ],
  },
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
