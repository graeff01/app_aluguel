"use server";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { requestCaptureFromSearch, setCaptureOwner } from "@/server/capture";
import { closeRadar } from "@/server/radar";

/** "Estou buscando" / "Parar de buscar" no pedido. */
export async function captureOwnerAction(id: string, take: boolean): Promise<ActionState> {
  const s = await runAction(async (a) => {
    await setCaptureOwner(a, id, take);
    return take ? "Pedido seu: quem pediu foi avisado." : "Pedido livre de novo.";
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

/** Consultora: passa o cliente em busca à captação. */
export async function requestCaptureAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await runAction(async (a) => {
    await requestCaptureFromSearch(a, str(fd, "searchId"), str(fd, "wants"));
    return "Pedido enviado à captação. Você recebe um aviso a cada novidade.";
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

/** Consultora: encerra o pedido à captação (cliente não precisa mais). */
export async function closeCaptureRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await runAction(async (a) => {
    await closeRadar(a, str(fd, "id"), { reason: str(fd, "reason"), note: str(fd, "note") });
    return "Pedido à captação encerrado.";
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}
