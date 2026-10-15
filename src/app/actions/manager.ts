"use server";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { nudgeConsultant } from "@/server/insights";
import { markLeasePosted, updateOpportunity } from "@/server/opportunities";

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

/** Marketing: marcar locação como postada (ou desfazer). */
export async function leasePostedAction(_: ActionState, fd: FormData) {
  const s = await runAction(async (a) => {
    const posted = str(fd, "posted") === "1";
    await markLeasePosted(a, str(fd, "postId"), posted);
    return posted ? "Marcada como postada." : "Voltou para a lista de postar.";
  });
  if (s.ok) revalidatePath("/", "layout");
  return s;
}
