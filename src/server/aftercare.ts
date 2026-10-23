/**
 * Pós-contrato (opção por consultora, ligada pela gestão): depois do contrato assinado, dois contatos com o cliente.
 * 1. Boas-vindas: 5 dias depois da assinatura, saber como está a nova moradia e criar conexão.
 * 2. Indicação: 5 dias depois do 1º contato, pedir uma indicação (com sugestão de abordagem).
 * Cada etapa fica pendente na tela inicial até a consultora marcar que fez. Vale para contratos assinados a partir
 * do dia em que a opção foi ligada; negócio que caiu depois sai da lista.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { addDays, dateOnlyFromKey, dayKey } from "@/lib/time";

export const AFTERCARE_DAYS = 5;
export type AftercareStep = "welcome" | "referral";

export const AFTERCARE_STEP_LABEL: Record<AftercareStep, string> = {
  welcome: "Como está a nova moradia?",
  referral: "Pedir uma indicação",
};

const first = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** Mensagem pronta para o WhatsApp (a consultora ajusta antes de enviar). */
export function aftercareMessage(step: AftercareStep, clientName: string, consultantName: string) {
  const c = first(clientName);
  const me = first(consultantName);
  return step === "welcome"
    ? `Oi${c ? `, ${c}` : ""}! Aqui é a ${me}. Passando para saber como estão os primeiros dias na casa nova. Está tudo certo com o imóvel? Se precisar de qualquer coisa, pode contar comigo! 🏡`
    : `Oi${c ? `, ${c}` : ""}! Que bom saber que está tudo certo por aí 😊 Uma pergunta rápida: você conhece alguém (amigo, colega ou familiar) que também esteja procurando imóvel para alugar? Se puder me indicar, vou cuidar com o mesmo carinho que tive com você. É só me passar o nome e o telefone, ou compartilhar o meu contato. Obrigada! ${me}`;
}

/** Dicas da abordagem do pedido de indicação (aparecem junto da mensagem). */
export const REFERRAL_TIPS = [
  "Peça logo depois de o cliente contar algo positivo sobre a mudança.",
  "Deixe fácil: só o nome e o telefone, ou ele compartilha o seu contato.",
  "Agradeça mesmo que ele não tenha ninguém agora: a porta fica aberta.",
];

/** Contatos pós-contrato que já venceram para a consultora (vazio se a opção estiver desligada). */
export async function dueAftercare(userId: string, now = new Date()) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { aftercareSince: true, name: true, active: true } });
  if (!user?.aftercareSince || !user.active) return [];
  const today = dayKey(now);
  const since = dateOnlyFromKey(dayKey(user.aftercareSince));
  const welcomeLimit = dateOnlyFromKey(addDays(today, -AFTERCARE_DAYS));
  const rows = await db.opportunity.findMany({
    where: {
      status: "CLOSED_WON",
      closedAt: { gte: since },
      OR: [{ closedResponsibleId: userId }, { closedResponsibleId: null, responsibleId: userId }],
      aftercareReferralAt: null,
      client: { anonymizedAt: null },
    },
    orderBy: { closedAt: "asc" },
    select: {
      id: true,
      closedAt: true,
      aftercareWelcomeAt: true,
      client: { select: { name: true, phones: { where: { valid: true, normalized: { not: null } }, select: { normalized: true }, orderBy: { createdAt: "desc" }, take: 1 } } },
      property: { select: { code: true, photoUrl: true, neighborhood: true } },
    },
  });
  const out: {
    opportunityId: string;
    step: AftercareStep;
    dueOn: string;
    clientName: string;
    phone: string | null;
    propertyCode: string;
    photoUrl: string | null;
    neighborhood: string | null;
    signedOn: string;
    message: string;
  }[] = [];
  for (const o of rows) {
    if (!o.closedAt) continue;
    const signed = o.closedAt.toISOString().slice(0, 10);
    let step: AftercareStep;
    let dueOn: string;
    if (!o.aftercareWelcomeAt) {
      if (o.closedAt > welcomeLimit) continue;
      step = "welcome";
      dueOn = addDays(signed, AFTERCARE_DAYS);
    } else {
      dueOn = addDays(dayKey(o.aftercareWelcomeAt), AFTERCARE_DAYS);
      if (dueOn > today) continue;
      step = "referral";
    }
    out.push({
      opportunityId: o.id,
      step,
      dueOn,
      clientName: o.client.name,
      phone: o.client.phones[0]?.normalized ?? null,
      propertyCode: o.property.code,
      photoUrl: o.property.photoUrl,
      neighborhood: o.property.neighborhood,
      signedOn: signed,
      message: aftercareMessage(step, o.client.name, user.name),
    });
  }
  return out;
}

/** A consultora marca que fez o contato da etapa. Fica no histórico do negócio. */
export async function completeAftercare(actor: AuthzActor, opportunityId: string, step: AftercareStep, now = new Date()) {
  const o = await db.opportunity.findUnique({ where: { id: opportunityId } });
  if (!o) throw notFound();
  const owner = o.closedResponsibleId ?? o.responsibleId;
  assert(owner === actor.id || hasGlobalView(actor));
  if (o.status !== "CLOSED_WON") throw new AppError("INVALID_STATE", "Este negócio não está com contrato assinado.");
  if (step === "welcome" && o.aftercareWelcomeAt) throw new AppError("INVALID_STATE", "Este contato já foi registrado.");
  if (step === "referral" && (!o.aftercareWelcomeAt || o.aftercareReferralAt)) throw new AppError("INVALID_STATE", o.aftercareReferralAt ? "Este contato já foi registrado." : "Registre antes o contato de boas-vindas.");
  await db.$transaction(async (tx) => {
    await tx.opportunity.update({ where: { id: opportunityId }, data: step === "welcome" ? { aftercareWelcomeAt: now } : { aftercareReferralAt: now } });
    await tx.opportunityEvent.create({
      data: {
        opportunityId,
        fromStatus: o.status,
        toStatus: o.status,
        fromStage: o.stage,
        toStage: o.stage,
        note: step === "welcome" ? "Pós-contrato: contato de boas-vindas feito (como está a nova moradia)." : "Pós-contrato: indicação pedida ao cliente.",
        authorId: actor.id,
      },
    });
    await audit(tx, { actorId: actor.id, action: step === "welcome" ? "aftercare.welcome_done" : "aftercare.referral_done", entityType: "Opportunity", entityId: opportunityId });
  });
}

/** Gestão liga/desliga a opção para uma consultora. */
export async function setAftercare(actor: AuthzActor, userId: string, on: boolean, now = new Date()) {
  assert(hasGlobalView(actor));
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw notFound();
  if (u.role !== "CONSULTANT") throw new AppError("VALIDATION", "O pós-contrato vale só para consultoras.");
  if (on === !!u.aftercareSince) return u.aftercareSince;
  const since = on ? now : null;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { aftercareSince: since } });
    await audit(tx, { actorId: actor.id, action: on ? "user.aftercare_on" : "user.aftercare_off", entityType: "User", entityId: userId });
  });
  return since;
}
