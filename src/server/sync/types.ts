/** Subconjunto do recurso Event da Calendar API v3 usado pela integração. */
export type GEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled" | string | null;
  summary?: string | null;
  description?: string | null;
  /** campo "Local" do evento (endereço do imóvel, quando preenchido) */
  location?: string | null;
  updated?: string | null;
  etag?: string | null;
  iCalUID?: string | null;
  recurringEventId?: string | null;
  originalStartTime?: { dateTime?: string | null; date?: string | null } | null;
  start?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null;
  organizer?: { email?: string | null } | null;
  /** quem criou o evento (pode diferir da organizadora em agendas compartilhadas) */
  creator?: { email?: string | null } | null;
  attendees?: { email?: string | null; organizer?: boolean | null; resource?: boolean | null; responseStatus?: string | null; self?: boolean | null }[] | null;
  attendeesOmitted?: boolean | null;
  /** cor do evento (paleta do Google, "1"–"11"); sem cor = cor da agenda */
  colorId?: string | null;
  /** endereço do evento no Google Agenda */
  htmlLink?: string | null;
};

export type GCalendar = { id: string; summary: string; accessRole: string; primary?: boolean; backgroundColor?: string | null; selected?: boolean };

export type ListParams = {
  calendarId: string;
  syncToken?: string;
  timeMin?: string;
  timeMax?: string;
  pageToken?: string;
};

export type ListPage = { items: GEvent[]; nextPageToken?: string | null; nextSyncToken?: string | null };

/** Abstração da API (implementação real em google.ts; mocks em tests/). */
export interface CalendarApi {
  listCalendars(): Promise<GCalendar[]>;
  listEvents(p: ListParams): Promise<ListPage>;
  /** null quando o evento não existe mais (404/410) */
  getEvent(calendarId: string, eventId: string): Promise<GEvent | null>;
  /** cancela o evento: "canceled" (organizadora, para todos), "removed" (convidada, só da própria agenda), "already" */
  cancelEvent(calendarId: string, eventId: string): Promise<"canceled" | "removed" | "already">;
  /** troca o título (só se a agenda for a organizadora): "updated", "not_owner" ou "already" (evento sumiu) */
  updateSummary(calendarId: string, eventId: string, summary: (current: string) => string): Promise<"updated" | "not_owner" | "already">;
  /** cria o evento da visita marcada no app (convidados recebem o convite); devolve o id do evento */
  insertEvent(calendarId: string, ev: { summary: string; description: string; location?: string; start: Date; end: Date; attendees: string[]; allDay?: { startDay: string; endDay: string }; colorId?: string }): Promise<string>;
  /** cor do evento nesta agenda (vale também para a cópia de convidada; ninguém é notificado) */
  setColor(calendarId: string, eventId: string, colorId: string): Promise<"updated" | "gone">;
  /** atualiza o evento (só se a agenda for a organizadora): horário, título, local e troca de convidada */
  patchEvent(calendarId: string, eventId: string, patch: { summary?: string; description?: string; start?: Date; end?: Date; allDay?: { startDay: string; endDay: string }; location?: string; swapAttendees?: { remove: string[]; add: string[] } }): Promise<"updated" | "not_owner" | "gone">;
  /** desfazer: reabre um evento cancelado pelo app */
  restoreEvent(calendarId: string, eventId: string): Promise<"restored" | "gone">;
}

export type GoogleErrorKind = "SYNC_TOKEN_INVALID" | "AUTH" | "PERMISSION" | "RETRYABLE" | "NOT_FOUND" | "OTHER";

export class GoogleApiError extends Error {
  constructor(
    readonly kind: GoogleErrorKind,
    readonly status: number | null,
    readonly retryAfterMs: number | null = null,
    readonly reason: string | null = null,
  ) {
    super(`Google API ${kind}${status ? ` (${status})` : ""}${reason ? `: ${reason}` : ""}`);
    this.name = "GoogleApiError";
  }
  get code() {
    return `GOOGLE_${this.kind}`;
  }
}

/** Papéis com acesso a detalhes dos eventos. freeBusyReader NÃO serve. */
export const DETAIL_ROLES = new Set(["reader", "writer", "owner"]);
