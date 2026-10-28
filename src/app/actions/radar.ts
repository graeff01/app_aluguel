"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { closeRadar, createRadar, radarOptionsSent, reopenRadar, updateRadar } from "@/server/radar";
import { searchOptionsSent } from "@/server/client-search";

export async function createRadarAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const s = await runAction(async (a) => {
    const r = await createRadar(a, {
      clientName: str(fd, "clientName"),
      phone: str(fd, "phone"),
      wants: str(fd, "wants"),
      maxBudget: str(fd, "maxBudget"),
      areas: str(fd, "areas"),
      propertyType: str(fd, "propertyType"),
      bedrooms: str(fd, "bedrooms"),
      sentToCapture: str(fd, "sentToCapture") === "1",
      followUpDays: str(fd, "followUpDays"),
      requestId: str(fd, "requestId") || undefined,
    });
    id = r.id;
    return "Cliente no radar.";
  });
  if (s.ok && id) {
    revalidatePath("/", "layout");
    redirect(`/radar/${id}?novo=1`);
  }
  return s;
}

export async function updateRadarAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const s = await runAction(async (a) => {
    await updateRadar(a, id, { note: str(fd, "note"), followUpDays: str(fd, "followUpDays"), foundCodes: str(fd, "foundCodes"), sentToCapture: str(fd, "sentToCapture") === "1" });
    return "Atualização registrada.";
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

export async function closeRadarAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await runAction(async (a) => {
    await closeRadar(a, str(fd, "id"), { reason: str(fd, "reason"), note: str(fd, "note") });
    return "Pedido encerrado.";
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

export async function reopenRadarAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await runAction(async (a) => {
    await reopenRadar(a, str(fd, "id"));
    return "Pedido reaberto.";
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

/** Opções do site enviadas/indicadas ao cliente (radar ou cliente em busca). Chamada direto pelo componente. */
export async function optionsSentAction(kind: "radar" | "search", id: string, codes: string[], via: "whatsapp" | "manual"): Promise<ActionState> {
  const s = await runAction(async (a) => {
    if (kind === "radar") await radarOptionsSent(a, id, codes, via);
    else await searchOptionsSent(a, id, codes, via);
    return codes.length === 1 ? "Opção registrada no histórico." : `${codes.length} opções registradas no histórico.`;
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}
