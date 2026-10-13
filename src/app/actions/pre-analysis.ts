"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { createPreAnalysis, deletePreAnalysis, resolvePreAnalysis } from "@/server/pre-analysis";

export async function createPreAnalysisAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const s = await runAction(async (a) => {
    const p = await createPreAnalysis(a, {
      fullName: str(fd, "fullName"),
      birthDate: str(fd, "birthDate"),
      cpf: str(fd, "cpf"),
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      salary: str(fd, "salary"),
      consultantId: str(fd, "consultantId"),
      propertyCode: str(fd, "propertyCode"),
      note: str(fd, "note"),
      holderConfirmed: (str(fd, "holder") === "1") as true,
    });
    id = p.id;
    return "Pré-análise enviada.";
  });
  if (s.ok && id) {
    revalidatePath("/pre-analises");
    redirect(`/pre-analises/${id}?enviada=1`);
  }
  return s;
}

export async function resolvePreAnalysisAction(_: ActionState, fd: FormData) {
  const id = str(fd, "id");
  const s = await runAction(async (a) => {
    const st = await resolvePreAnalysis(a, id, { status: str(fd, "status"), note: str(fd, "note") });
    return st === "PENDING" ? "Marcada como pendente. O pré-atendimento foi avisado." : "Resultado registrado. O pré-atendimento foi avisado.";
  });
  if (s.ok) {
    revalidatePath(`/pre-analises/${id}`);
    revalidatePath("/pre-analises");
  }
  return s;
}

export async function deletePreAnalysisAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await runAction(async (a) => {
    await deletePreAnalysis(a, str(fd, "id"));
  });
  if (s.ok) redirect("/pre-analises?excluida=1");
  return s;
}
