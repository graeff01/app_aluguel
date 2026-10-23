"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { createProposal, deleteProposal, updateProposalStatus } from "@/server/proposals";
import { completeAftercare, setAftercare } from "@/server/aftercare";
import { refreshPropertyNow } from "@/server/property-preview";

export async function createProposalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const s = await runAction(async (a) => {
    const p = await createProposal(a, {
      clientName: str(fd, "clientName"),
      phone: str(fd, "phone"),
      rent: str(fd, "rent"),
      propertyCode: str(fd, "propertyCode"),
      consultantId: str(fd, "consultantId"),
      ownClient: str(fd, "ownClient") === "1",
      note: str(fd, "note"),
      requestId: str(fd, "requestId") || undefined,
      confirmAway: str(fd, "confirmAway") === "1",
    });
    id = p.id;
    // foto e bairro do imóvel para a ficha da proposta
    void refreshPropertyNow(p.propertyCode).catch(() => undefined);
    return "Proposta enviada.";
  });
  if (s.ok && id) {
    revalidatePath("/propostas");
    redirect(`/propostas/${id}?enviada=1`);
  }
  return s;
}

export async function updateProposalAction(_: ActionState, fd: FormData) {
  const id = str(fd, "id");
  const s = await runAction(async (a) => {
    const st = await updateProposalStatus(a, id, { status: str(fd, "status"), counter: str(fd, "counter"), note: str(fd, "note") });
    return st === "SENT" ? "Marcada como enviada ao proprietário. O pré-atendimento foi avisado." : "Andamento registrado. O pré-atendimento foi avisado.";
  });
  if (s.ok) {
    revalidatePath(`/propostas/${id}`);
    revalidatePath("/propostas");
  }
  return s;
}

export async function deleteProposalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await runAction(async (a) => {
    await deleteProposal(a, str(fd, "id"));
  });
  if (s.ok) redirect("/propostas?excluida=1");
  return s;
}

export async function completeAftercareAction(_: ActionState, fd: FormData) {
  const s = await runAction(async (a) => {
    const step = str(fd, "step") === "referral" ? "referral" : "welcome";
    await completeAftercare(a, str(fd, "opportunityId"), step);
    return step === "welcome" ? "Contato registrado. Daqui a 5 dias aparece o pedido de indicação." : "Indicação pedida. Pós-contrato concluído.";
  });
  if (s.ok) revalidatePath("/minhas");
  return s;
}

export async function setAftercareAction(_: ActionState, fd: FormData) {
  const userId = str(fd, "userId");
  const s = await runAction(async (a) => {
    const since = await setAftercare(a, userId, str(fd, "on") === "1");
    return since ? "Pós-contrato ligado: vale para os contratos assinados a partir de hoje." : "Pós-contrato desligado.";
  });
  if (s.ok) revalidatePath(`/config/usuarios/${userId}`);
  return s;
}
