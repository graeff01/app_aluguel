/**
 * Agenda central com cor por quem agendou: os eventos de visita agendados pelas consultoras (no app ou na agenda
 * delas) ganham a cor escolhida em Regras e app, para o pré-atendimento separar de relance o que é dele.
 * Só pinta evento ainda sem cor e uma vez só: se alguém trocar a cor à mão no Google, fica a escolhida.
 */
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { getSettings } from "@/lib/settings";
import { GOOGLE_EVENT_COLORS } from "@/lib/event-colors";
import { dayKey, startOfDayInTz } from "@/lib/time";
import type { CalendarApi } from "./sync/types";

/** Cor dos eventos das consultoras (null = desligado). */
export async function consultantEventColor() {
  const c = (await getSettings()).consultantEventColor;
  return GOOGLE_EVENT_COLORS[c] ? c : null;
}

export async function paintConsultantEvents(api: CalendarApi, calendarId: string, now = new Date()) {
  const color = await consultantEventColor();
  if (!color) return 0;
  const rows = await db.sourceEvent.findMany({
    where: {
      calendarId,
      colorId: null,
      colorPaintedAt: null,
      googleStatus: { not: "cancelled" },
      endAt: { gte: startOfDayInTz(dayKey(now)) },
      visit: { excluded: false, scheduledBy: { role: "CONSULTANT" } },
    },
    orderBy: { startAt: "asc" },
    select: { id: true, googleEventId: true },
    take: 40,
  });
  let painted = 0;
  for (const r of rows) {
    try {
      const res = await api.setColor(calendarId, r.googleEventId, color);
      await db.sourceEvent.update({ where: { id: r.id }, data: { colorPaintedAt: now, ...(res === "updated" ? { colorId: color } : {}) } });
      if (res === "updated") painted++;
    } catch (e) {
      log.warn("google.color_failed", { kind: (e as { kind?: string }).kind ?? "OTHER" });
      break; // sem permissão / limite: tenta de novo na próxima leitura
    }
  }
  return painted;
}
