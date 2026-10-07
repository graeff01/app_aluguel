"use server";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { nudgeConsultant } from "@/server/insights";
import { updateOpportunity } from "@/server/opportunities";

export async function nudgeAction(_: ActionState, fd: FormData) {
  return runAction((a) => nudgeConsultant(a, str(fd, "consultantId")));
}

/** Movimento simples no quadro (acompanhamento ↔ documentação). Fechar/perder exige o formulário completo. */
export async function moveOpportunityAction(_: ActionState, fd: FormData) {
  const s = await runAction(async (a) => {
    const to = str(fd, "toStatus");
    if (to !== "FOLLOW_UP" && to !== "DOCS_REVIEW") throw new Error("movimento inválido");
    await updateOpportunity(a, str(fd, "oppId"), { expectedVersion: Number(str(fd, "version")), toStatus: to, note: "" });
    return "Movido.";
  });
  if (s.ok) revalidatePath("/oportunidades");
  return s;
}
