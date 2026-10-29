"use server";
import { revalidatePath } from "next/cache";
import { clientIp } from "@/lib/session";
import { runAction, str, toState, type ActionState } from "@/lib/action";
import { createOwnerLead, ownerEstimate, updateOwnerLead, type OwnerEstimate } from "@/server/owner-leads";

/** Página pública: estimativa para o proprietário (sem login). */
export async function ownerEstimateAction(input: { area: string; propertyType: string; bedrooms: string }): Promise<{ ok: true; data: OwnerEstimate } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await ownerEstimate(input, await clientIp()) };
  } catch (e) {
    return { ok: false, message: toState(e).message ?? "Não foi possível calcular agora." };
  }
}

/** Página pública: o proprietário pede o contato da captação. */
export async function ownerLeadAction(input: { area: string; propertyType: string; bedrooms: string; name: string; phone: string; wanted: string; message: string; consent: boolean; estimateCents: number | null; demand: number }): Promise<ActionState> {
  try {
    const bedrooms = input.bedrooms === "" ? null : Number(input.bedrooms);
    await createOwnerLead({ ...input, bedrooms }, await clientIp());
    return { ok: true, message: "Recebido!", at: Date.now() };
  } catch (e) {
    return toState(e);
  }
}

/** Captação: "vou atender", situação e observação de um contato de proprietário. */
export async function ownerLeadUpdateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await runAction(async (a) => {
    await updateOwnerLead(a, str(fd, "id"), { status: str(fd, "status") || undefined, note: fd.has("note") ? str(fd, "note") : undefined, take: str(fd, "take") === "1" });
    return "Salvo.";
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}
