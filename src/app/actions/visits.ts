"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, str, type ActionState } from "@/lib/action";
import { assignVisit, cancelVisitByStaff, correctVisitData, undoStaffCancel, createManualVisit, resolveConflict, setVisitExcluded, type ConflictAction } from "@/server/visits";
import { confirmVisitClientAsDistinct, linkVisitToClient, mergeClients } from "@/server/clients";
import { updateOpportunity, transferOpportunity } from "@/server/opportunities";
import { acceptAmbiguous, rejectAmbiguous } from "@/server/review";
import { rescheduleVisit } from "@/server/reschedule";
import { setPresence } from "@/server/presence";
import { followUpAction } from "@/server/followups";
import { refreshPropertyNow } from "@/server/property-preview";
import { ensurePropertyCoords } from "@/server/geo";
import { db } from "@/lib/db";
import { getActor } from "@/lib/session";
import { toState } from "@/lib/action";
import { hasGlobalView } from "@/lib/authz";
import { GOOGLE_UNDO_TEXT } from "@/lib/cancel-messages";

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
      agentId: str(fd, "agentId") || undefined,
      highlightIds: fd.getAll("highlightIds").map(String).filter(Boolean),
      highlightNote: str(fd, "highlightNote"),
    });
  } catch (e) {
    return toState(e);
  }
  revalidatePath("/", "layout");
  // o formulário recarrega com a nova versão: a confirmação fica na página
  redirect(`/oportunidades/${str(fd, "oppId")}?salvo=${encodeURIComponent(str(fd, "toStatus"))}`);
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

export async function rescheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const s = await runAction(async (a) => {
    const mode = str(fd, "mode") === "new" ? "new" : "reschedule";
    const os = str(fd, "outcomeStatus");
    const outcome =
      os === "RESCHEDULED" || os === "NO_SHOW" || os === "DONE"
        ? {
            status: os as "RESCHEDULED" | "NO_SHOW" | "DONE",
            evaluation: (["POSITIVE", "NEGATIVE", "UNDECIDED"].includes(str(fd, "evaluation")) ? str(fd, "evaluation") : null) as "POSITIVE" | "NEGATIVE" | "UNDECIDED" | null,
            negativeReasonId: str(fd, "negativeReasonId") || null,
            note: str(fd, "outcomeNote"),
          }
        : undefined;
    const v = await rescheduleVisit(a, str(fd, "visitId"), {
      outcome,
      requestId: str(fd, "requestId"),
      scheduledStart: `${str(fd, "date")}T${str(fd, "time")}`,
      durationMinutes: Number(str(fd, "duration")) || 60,
      mode,
      note: str(fd, "note"),
      propertyCode: str(fd, "propertyCode"),
      allowOverlap: str(fd, "allowOverlap") === "1",
    });
    // dados do anúncio do imóvel (inclusive se trocou o código) já na hora, sem esperar o worker
    const prop = v.propertyCode ? await db.property.findUnique({ where: { code: v.propertyCode }, select: { neighborhood: true, rent: true, pageCheckedAt: true } }) : null;
    if (v.propertyCode && (!prop?.pageCheckedAt || (!prop.neighborhood && !prop.rent))) {
      // em segundo plano: a tela avança na hora; foto, bairro e valores chegam em seguida
      const code = v.propertyCode;
      void refreshPropertyNow(code)
        .then(() => ensurePropertyCoords([code], { maxCalls: 2 }))
        .catch(() => undefined);
    }
    target = `/visitas/${v.id}/agenda?${v.assignmentNote === "REAGENDADA" ? "remarcada" : "nova"}=1`;
  });
  if (s.ok && target) redirect(target);
  return s;
}

export async function setPresenceAction(visitId: string, status: "CONFIRMED" | "NO_REPLY" | null): Promise<ActionState> {
  return runAction(async (a) => {
    await setPresence(a, visitId, status);
    revalidatePath("/minhas");
    return status === "CONFIRMED" ? "Presença confirmada." : status === "NO_REPLY" ? "Marcado: sem resposta." : "Confirmação removida.";
  });
}

export async function followUpDoneAction(visitId: string, action: "done" | "snooze"): Promise<ActionState> {
  return runAction(async (a) => {
    await followUpAction(a, visitId, action);
    revalidatePath("/minhas");
    return action === "done" ? "Retorno feito." : "Adiado para daqui a 2 dias.";
  });
}

export async function cancelVisitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const s = await runAction(async (a) => {
    const r = await cancelVisitByStaff(a, str(fd, "visitId"), { reasonId: str(fd, "reasonId"), note: str(fd, "note"), onlyThis: str(fd, "scope") === "one" });
    // volta para a mesma tela (dia/semana/mês) com o resultado e o "Desfazer"
    const back = str(fd, "back").startsWith("/agenda-do-dia") ? str(fd, "back") : "/agenda-do-dia";
    target = `${back}${back.includes("?") ? "&" : "?"}cancelado=${r.undoId}&n=${r.count}&g=${r.google}`;
    return "Visita cancelada.";
  });
  if (s.ok && target) {
    revalidatePath("/agenda-do-dia");
    redirect(target);
  }
  return s;
}

export async function undoCancelAction(undoId: string): Promise<ActionState> {
  const s = await runAction(async (a) => {
    const r = await undoStaffCancel(a, undoId);
    return `Cancelamento desfeito${r.count > 1 ? ` (${r.count} imóveis)` : ""}. A consultora foi avisada. ${GOOGLE_UNDO_TEXT[r.google] ?? ""}`.trim();
  });
  if (s.ok) revalidatePath("/agenda-do-dia");
  return s;
}
