"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, str, type ActionState } from "@/lib/action";
import { assignVisit, correctVisitData, createManualVisit, resolveConflict, setVisitExcluded, type ConflictAction } from "@/server/visits";
import { confirmVisitClientAsDistinct, linkVisitToClient, mergeClients } from "@/server/clients";
import { updateOpportunity, transferOpportunity } from "@/server/opportunities";
import { acceptAmbiguous, rejectAmbiguous } from "@/server/review";
import { getActor } from "@/lib/session";
import { toState } from "@/lib/action";
import { hasGlobalView } from "@/lib/authz";

export async function correctVisitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "visitId");
  const back = str(fd, "voltar");
  let consultantIsGlobal = true;
  const state = await runAction(async (actor) => {
    consultantIsGlobal = hasGlobalView(actor);
    await correctVisitData(actor, id, {
      expectedVersion: Number(str(fd, "version")),
      clientName: str(fd, "clientName"),
      phoneRaw: str(fd, "phoneRaw"),
      propertyCode: str(fd, "propertyCode"),
      scheduledStart: str(fd, "scheduledStart") || undefined,
      scheduledEnd: str(fd, "scheduledEnd") || undefined,
      reason: str(fd, "reason") || undefined,
    });
  });
  if (state.ok) {
    revalidatePath("/", "layout");
    redirect(back === "registrar" || !consultantIsGlobal ? `/visitas/${id}/registrar` : `/visitas/${id}?corrigido=1`);
  }
  return state;
}

export async function createVisitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let createdId = "";
  let toMine = false;
  const state = await runAction(async (actor) => {
    toMine = !hasGlobalView(actor);
    const v = await createManualVisit(actor, {
      requestId: str(fd, "requestId"),
      scheduledStart: str(fd, "scheduledStart"),
      durationMinutes: Number(str(fd, "duration") || 60),
      clientName: str(fd, "clientName"),
      phoneRaw: str(fd, "phoneRaw"),
      propertyCode: str(fd, "propertyCode"),
      consultantId: str(fd, "consultantId") || undefined,
    });
    createdId = v.id;
  });
  if (state.ok && createdId) {
    revalidatePath("/", "layout");
    redirect(toMine ? "/minhas" : `/visitas/${createdId}?criada=1`);
  }
  return state;
}

export async function assignVisitAction(_: ActionState, fd: FormData) {
  return done(await runAction((a) => assignVisit(a, str(fd, "visitId"), str(fd, "consultantId"), str(fd, "note")).then(() => "Atribuição salva.")));
}
export async function excludeVisitAction(_: ActionState, fd: FormData) {
  return done(await runAction((a) => setVisitExcluded(a, str(fd, "visitId"), str(fd, "excluded") === "1", str(fd, "note")).then(() => "Atualizado.")));
}
export async function resolveConflictAction(_: ActionState, fd: FormData) {
  return done(await runAction((a) => resolveConflict(a, str(fd, "visitId"), str(fd, "action") as ConflictAction, str(fd, "note")).then(() => "Conflito resolvido.")));
}
export async function linkClientAction(_: ActionState, fd: FormData) {
  return done(await runAction((a) => linkVisitToClient(a, str(fd, "visitId"), str(fd, "clientId")).then(() => "Vínculo confirmado.")));
}
export async function distinctClientAction(_: ActionState, fd: FormData) {
  return done(await runAction((a) => confirmVisitClientAsDistinct(a, str(fd, "visitId")).then(() => "Confirmado como pessoa distinta.")));
}
export async function mergeClientsAction(_: ActionState, fd: FormData) {
  return done(await runAction((a) => mergeClients(a, str(fd, "sourceId"), str(fd, "targetId")).then(() => "Cadastros unidos.")));
}
export async function ambiguousAction(_: ActionState, fd: FormData) {
  const id = str(fd, "sourceEventId");
  return done(await runAction((a) => (str(fd, "decision") === "accept" ? acceptAmbiguous(a, id) : rejectAmbiguous(a, id)).then(() => "Decisão registrada.")));
}
export async function opportunityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActor();
  if (!actor) return { ok: false, message: "Sessão expirada." };
  try {
    await updateOpportunity(actor, str(fd, "oppId"), {
      expectedVersion: Number(str(fd, "version")),
      toStatus: str(fd, "toStatus") as "FOLLOW_UP",
      note: str(fd, "note"),
      closedAt: str(fd, "closedAt") || undefined,
      closedResponsibleId: str(fd, "closedResponsibleId") || undefined,
      lostReasonId: str(fd, "lostReasonId") || undefined,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Andamento atualizado.", at: Date.now() };
  } catch (e) {
    return toState(e);
  }
}
export async function transferOpportunityAction(_: ActionState, fd: FormData) {
  return done(await runAction((a) => transferOpportunity(a, str(fd, "oppId"), str(fd, "responsibleId"), str(fd, "note")).then(() => "Responsável alterada.")));
}

function done(s: ActionState) {
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

export async function anonymizeClientAction(_: ActionState, fd: FormData) {
  const { anonymizeClient } = await import("@/server/privacy");
  return done(await runAction((a) => anonymizeClient(a, str(fd, "clientId"), str(fd, "reason")).then((ok) => (ok ? "Dados pessoais removidos. Os indicadores foram preservados." : "Este cliente já estava anonimizado."))));
}
