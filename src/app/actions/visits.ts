"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, str, type ActionState } from "@/lib/action";
import { assignVisit, cancelVisitByStaff, correctVisitData, undoStaffCancel, createManualVisit, resolveConflict, setVisitExcluded, type ConflictAction } from "@/server/visits";
import { confirmVisitClientAsDistinct, linkVisitToClient, mergeClients } from "@/server/clients";
import { updateOpportunity, transferOpportunity } from "@/server/opportunities";
import { acceptAmbiguous, rejectAmbiguous } from "@/server/review";
import { createVisitEventInGoogle, rescheduleVisit } from "@/server/reschedule";
import { cancelOldEvent } from "@/server/google-write";
import { createStaffVisit } from "@/server/staff-visit";
import { moveDealStage } from "@/server/deal-flow";
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
  return done(
    await runAction((a) =>
      assignVisit(a, str(fd, "visitId"), str(fd, "consultantId"), str(fd, "note")).then((g) =>
        g === "updated" ? "Atribuição salva. A consultora foi convidada no evento da agenda." : g === "not_owner" ? "Atribuição salva. O evento é de outra pessoa: convide a consultora na agenda." : "Atribuição salva.",
      ),
    ),
  );
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
    // o app já cria o evento na agenda (se tiver permissão); senão a tela oferece o botão
    const g = await createVisitEventInGoogle(a, v.id).catch(() => "error" as const);
    // remarcada: o evento antigo sai da agenda (o novo já foi criado) — nada de dois eventos para a mesma visita
    if (g === "created" && v.rescheduledFromId) {
      const old = await db.visit.findUnique({ where: { id: v.rescheduledFromId }, select: { status: true } });
      if (old?.status === "RESCHEDULED") await cancelOldEvent(v.rescheduledFromId).catch(() => undefined);
    }
    target = `/visitas/${v.id}/agenda?${v.assignmentNote === "REAGENDADA" ? "remarcada" : "nova"}=1&google=${g}`;
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

/** Pré-atendimento agenda a visita pelo app (o evento vai para a agenda Google já no padrão). */
export async function createStaffVisitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const s = await runAction(async (a) => {
    const r = await createStaffVisit(a, {
      requestId: str(fd, "requestId"),
      clientName: str(fd, "clientName"),
      externalRef: str(fd, "externalRef"),
      phoneRaw: str(fd, "phoneRaw"),
      propertyCodes: str(fd, "propertyCodes"),
      consultantId: str(fd, "consultantId"),
      scheduledStart: `${str(fd, "date")}T${str(fd, "time")}`,
      durationMinutes: Number(str(fd, "duration")) || 60,
      note: str(fd, "note"),
      allowOverlap: str(fd, "allowOverlap") === "1",
    });
    target = `/agenda-do-dia?dia=${str(fd, "date")}&criada=${r.visit.id}&g=${r.google}`;
    return "Visita criada.";
  });
  if (s.ok && target) {
    revalidatePath("/agenda-do-dia");
    redirect(target);
  }
  return s;
}

/** Fluxo pós-visita: muda a situação do negócio (com os dados da etapa). */
export async function dealStageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "oppId");
  let to = "";
  const s = await runAction(async (a) => {
    const all = (k: string) => fd.getAll(k).map(String).filter(Boolean);
    const r = await moveDealStage(a, id, {
      expectedVersion: Number(str(fd, "version")),
      to: str(fd, "to") as never,
      note: str(fd, "note"),
      proposedRent: str(fd, "proposedRent"),
      intendedGuarantee: str(fd, "intendedGuarantee"),
      proposalSentAt: str(fd, "proposalSentAt"),
      ownerAcceptedAt: str(fd, "ownerAcceptedAt"),
      agreedRent: str(fd, "agreedRent"),
      kycSentAt: str(fd, "kycSentAt"),
      kycDueAt: str(fd, "kycDueAt"),
      guarantee: str(fd, "guarantee"),
      analysisDecidedAt: str(fd, "analysisDecidedAt"),
      docsMissingIds: all("docsMissingIds"),
      docsRequestedAt: str(fd, "docsRequestedAt"),
      contractReleasedAt: str(fd, "contractReleasedAt"),
      contractSentAt: str(fd, "contractSentAt"),
      inspectionNeeded: str(fd, "inspectionNeeded"),
      signedAt: str(fd, "signedAt"),
      dealType: str(fd, "dealType"),
      contractValue: str(fd, "contractValue"),
      agentId: str(fd, "agentId"),
      highlightIds: all("highlightIds"),
      highlightNote: str(fd, "highlightNote"),
      possessionAt: str(fd, "possessionAt"),
      keysHolderChecked: str(fd, "keysHolderChecked") === "1",
      lostReasonId: str(fd, "lostReasonId"),
    });
    to = r.to;
    return `Situação: ${r.label}.`;
  });
  if (!s.ok) return s;
  revalidatePath("/", "layout");
  redirect(`/oportunidades/${id}?salvo=${to}`);
}
