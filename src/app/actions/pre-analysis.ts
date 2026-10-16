"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { createPreAnalysis, deletePreAnalysis, resolvePreAnalysis } from "@/server/pre-analysis";
import { addPreAnalysisFiles, deletePreAnalysisFile } from "@/server/pre-analysis-files";
import { notifyUser } from "@/server/notify";
import { scheduleFromPreAnalysis } from "@/server/pre-visit";
import { createVisitEventInGoogle } from "@/server/reschedule";
import { refreshPropertyNow } from "@/server/property-preview";
import { ensurePropertyCoords } from "@/server/geo";

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
      guaranteeId: str(fd, "guaranteeId"),
      ownClient: str(fd, "ownClient") === "1",
      propertyCode: str(fd, "propertyCode"),
      note: str(fd, "note"),
      holderConfirmed: str(fd, "holder") === "1",
      requestId: str(fd, "requestId") || undefined,
      confirmRepeat: str(fd, "confirmRepeat") === "1",
      confirmAway: str(fd, "confirmAway") === "1",
    }, new Date(), fd.getAll("files").filter((f): f is File => typeof f !== "string"));
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
    const st = await resolvePreAnalysis(a, id, { status: str(fd, "status"), note: str(fd, "note"), missingIds: fd.getAll("missing").map(String).filter(Boolean) });
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

export async function schedulePreVisitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const s = await runAction(async (a) => {
    const v = await scheduleFromPreAnalysis(a, str(fd, "id"), {
      requestId: str(fd, "requestId"),
      scheduledStart: `${str(fd, "date")}T${str(fd, "time")}`,
      durationMinutes: Number(str(fd, "duration")) || 60,
      propertyCode: str(fd, "propertyCode"),
      allowOverlap: str(fd, "allowOverlap") === "1",
    });
    const code = v.propertyCode;
    if (code) void refreshPropertyNow(code).then(() => ensurePropertyCoords([code], { maxCalls: 2 })).catch(() => undefined);
    // o app já cria o evento na agenda (se tiver permissão); senão a tela oferece o botão
    const g = await createVisitEventInGoogle(a, v.id).catch(() => "error" as const);
    target = `/visitas/${v.id}/agenda?nova=1&google=${g}`;
  });
  if (s.ok && target) redirect(target);
  return s;
}

export async function addPreAnalysisFilesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const s = await runAction(async (a) => {
    const r = await addPreAnalysisFiles(a, id, fd.getAll("files").filter((f): f is File => typeof f !== "string"));
    // avisa o outro lado: quem anexou foi o pré-atendimento → consultora; foi a consultora → pré-atendimento
    const to = a.id === r.consultantId ? r.createdById : r.consultantId;
    if (to !== a.id)
      await notifyUser(to, {
        title: r.resubmitted ? "Pré-análise voltou para você" : "Novos documentos na pré-análise",
        body: r.resubmitted ? "O pré-atendimento enviou o que faltava. Toque para analisar de novo." : `${r.count} documento${r.count > 1 ? "s" : ""} anexado${r.count > 1 ? "s" : ""}. Toque para ver.`,
        url: `/pre-analises/${id}`,
        tag: `pre-${id}`,
      }).catch(() => undefined);
    const base = r.count > 1 ? `${r.count} documentos anexados.` : "Documento anexado.";
    return r.resubmitted ? `${base} A pré-análise voltou para a consultora analisar.` : base;
  });
  if (s.ok) revalidatePath(`/pre-analises/${id}`);
  return s;
}

export async function deletePreAnalysisFileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const s = await runAction(async (a) => {
    id = await deletePreAnalysisFile(a, str(fd, "fileId"));
    return "Documento removido.";
  });
  if (s.ok && id) revalidatePath(`/pre-analises/${id}`);
  return s;
}
