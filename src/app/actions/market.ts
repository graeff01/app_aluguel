"use server";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { deleteMarketNote, setRadarMarketNote, upsertMarketNote } from "@/server/market";

/** Parecer da captação em um pedido (id) ou leitura de mercado de um perfil (area + type). */
export async function marketNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await runAction(async (a) => {
    const input = { tag: str(fd, "tag"), text: str(fd, "text"), realistic: str(fd, "realistic") };
    if (str(fd, "radarId")) {
      await setRadarMarketNote(a, str(fd, "radarId"), input);
      return "Parecer enviado. O pré-atendimento foi avisado.";
    }
    await upsertMarketNote(a, { ...input, area: str(fd, "area"), type: str(fd, "type") || null });
    return "Leitura salva: aparece no mapa e para quem atende clientes com esse perfil.";
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

export async function deleteMarketNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await runAction(async (a) => {
    await deleteMarketNote(a, str(fd, "id"));
    return "Leitura removida.";
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}
