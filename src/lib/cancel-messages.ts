/** Textos do cancelamento pelo pré-atendimento (no app e no Google). */
export const GOOGLE_CANCEL_TEXT: Record<string, string> = {
  canceled: "Cancelada também na agenda Google (convidados avisados).",
  already: "Na agenda Google ela já estava cancelada.",
  removed: "Saiu da sua agenda Google; o evento é da consultora e ela foi avisada para apagar.",
  code_removed: "O código saiu do título do evento na agenda Google; os outros imóveis continuam.",
  not_owner: "O evento é da consultora: ela foi avisada para tirar o código do título.",
  no_permission: "Apague o evento na agenda Google: o app ainda não tem permissão de edição.",
  not_in_agenda: "",
  error: "Não consegui mexer na agenda Google agora: confira o evento lá.",
};

export const GOOGLE_UNDO_TEXT: Record<string, string> = {
  restored: "O evento voltou na agenda Google.",
  title_back: "O código voltou ao título do evento na agenda Google.",
  title_changed: "O título do evento foi editado depois: confira o código na agenda Google.",
  none: "",
  error: "Não consegui desfazer na agenda Google: confira o evento lá.",
};
