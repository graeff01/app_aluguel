"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { createMirrorEvent, deleteMirrorEvent, editMirrorEvent, moveMirrorEvent } from "@/server/calendar-mirror";

// Agenda Google dentro do app: cada ação vai direto para o Google.
const s = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : undefined);

export async function moveEventAction(input: { calendarId: string; eventId: string; start?: string; end?: string; startDay?: string; endDay?: string }): Promise<ActionState> {
  const r = await runAction(async (a) => {
    await moveMirrorEvent(a, { calendarId: s(input.calendarId, 300)!, eventId: s(input.eventId, 300)!, start: s(input.start, 40), end: s(input.end, 40), startDay: s(input.startDay, 10), endDay: s(input.endDay, 10) });
    return "Evento movido.";
  });
  if (r.ok) revalidatePath("/agenda-google");
  return r;
}

export async function createEventAction(input: { calendarId: string; title: string; description?: string; start?: string; end?: string; startDay?: string; endDay?: string }): Promise<ActionState> {
  const r = await runAction(async (a) => {
    await createMirrorEvent(a, { calendarId: s(input.calendarId, 300)!, title: s(input.title, 300) ?? "", description: s(input.description), start: s(input.start, 40), end: s(input.end, 40), startDay: s(input.startDay, 10), endDay: s(input.endDay, 10) });
    return "Evento criado.";
  });
  if (r.ok) revalidatePath("/agenda-google");
  return r;
}

export async function editEventAction(input: { calendarId: string; eventId: string; title: string; description?: string }): Promise<ActionState> {
  const r = await runAction(async (a) => {
    await editMirrorEvent(a, { calendarId: s(input.calendarId, 300)!, eventId: s(input.eventId, 300)!, title: s(input.title, 300) ?? "", description: s(input.description) });
    return "Evento salvo.";
  });
  if (r.ok) revalidatePath("/agenda-google");
  return r;
}

export async function deleteEventAction(input: { calendarId: string; eventId: string }): Promise<ActionState> {
  const r = await runAction(async (a) => {
    await deleteMirrorEvent(a, { calendarId: s(input.calendarId, 300)!, eventId: s(input.eventId, 300)! });
    return "Evento excluído.";
  });
  if (r.ok) revalidatePath("/agenda-google");
  return r;
}
