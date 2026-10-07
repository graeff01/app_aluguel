/**
 * MOCK da Google Calendar API (identificado como tal). Simula paginação, syncToken incremental,
 * token inválido (410), eventos cancelados e recorrências expandidas (singleEvents=true).
 * NÃO substitui validação real com uma conta Google.
 */
import { GoogleApiError, type CalendarApi, type GEvent, type ListParams } from "@/server/sync/types";

type Stored = { ev: GEvent; version: number };

export class MockCalendar implements CalendarApi {
  private events = new Map<string, Stored>();
  private version = 0;
  pageSize = 2;
  calls: ListParams[] = [];
  invalidateTokens = false;
  failNext: GoogleApiError[] = [];
  calendars = [{ id: "central@exemplo.test", summary: "Agenda central", accessRole: "reader" }];

  put(ev: GEvent) {
    this.version++;
    this.events.set(ev.id, { ev: { status: "confirmed", updated: new Date().toISOString(), ...ev }, version: this.version });
  }
  cancel(id: string) {
    const cur = this.events.get(id);
    this.version++;
    // Google devolve apenas id + status para excluídos
    this.events.set(id, { ev: { id, status: "cancelled", recurringEventId: cur?.ev.recurringEventId, originalStartTime: cur?.ev.originalStartTime }, version: this.version });
  }
  /** remove sem deixar rastro (simula item que sumiu da listagem; getEvent devolve null) */
  purge(id: string) {
    this.events.delete(id);
  }

  async listCalendars() {
    return this.calendars;
  }

  async listEvents(p: ListParams) {
    this.calls.push(p);
    const err = this.failNext.shift();
    if (err) throw err;
    if (p.syncToken && (p.timeMin || p.timeMax)) throw new GoogleApiError("OTHER", 400, null, "syncToken com timeMin/timeMax");
    if (p.syncToken && this.invalidateTokens) {
      this.invalidateTokens = false;
      throw new GoogleApiError("SYNC_TOKEN_INVALID", 410);
    }
    const since = p.syncToken ? Number(p.syncToken.replace("tok-", "")) : -1;
    let list = [...this.events.values()];
    if (since >= 0) list = list.filter((s) => s.version > since);
    else {
      list = list.filter((s) => {
        if (s.ev.status === "cancelled") return true;
        const start = new Date(s.ev.start?.dateTime ?? s.ev.start?.date ?? 0).getTime();
        const end = new Date(s.ev.end?.dateTime ?? s.ev.end?.date ?? 0).getTime();
        return (!p.timeMax || start < Date.parse(p.timeMax)) && (!p.timeMin || end > Date.parse(p.timeMin));
      });
    }
    list.sort((a, b) => a.version - b.version);
    const offset = p.pageToken ? Number(p.pageToken) : 0;
    const page = list.slice(offset, offset + this.pageSize);
    const more = offset + this.pageSize < list.length;
    return {
      items: page.map((s) => structuredClone(s.ev)),
      nextPageToken: more ? String(offset + this.pageSize) : null,
      nextSyncToken: more ? null : `tok-${this.version}`,
    };
  }

  async getEvent(_cal: string, id: string) {
    const s = this.events.get(id);
    return s ? structuredClone(s.ev) : null;
  }
}

export function visitEvent(id: string, opts: { title?: string; start: string; minutes?: number; attendees?: string[]; organizer?: string; description?: string; extra?: Partial<GEvent> }): GEvent {
  const start = new Date(opts.start);
  const end = new Date(start.getTime() + (opts.minutes ?? 60) * 60_000);
  return {
    id,
    iCalUID: `${id}@google.com`,
    summary: opts.title ?? "Visita clt - Cliente Exemplo 1234567 - cod 654321 - (51) 99876-5432",
    description: opts.description ?? null,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    organizer: { email: opts.organizer ?? "organizadora@exemplo.test" },
    attendees: [
      { email: opts.organizer ?? "organizadora@exemplo.test", organizer: true, responseStatus: "accepted" },
      ...(opts.attendees ?? ["consultora.a@exemplo.test"]).map((email) => ({ email, responseStatus: "needsAction" })),
    ],
    ...opts.extra,
  };
}
