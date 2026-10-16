/**
 * O pré-atendimento agenda a visita pelo app: o app cria a visita e o evento na agenda conectada, já no padrão
 * ("Visita clt - Nome nº - cod 123;456 - telefone"), com a consultora convidada. Acaba o título digitado à mão.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assert, hasGlobalView, isPreService, type AuthzActor } from "@/lib/authz";
import { fromLocalInput, fmt } from "@/lib/time";
import { normalizePhone } from "@/lib/phone";
import { resolveClient } from "./clients";
import { ensureProperty } from "./visits";
import { assertNoOverlap, createVisitEventInGoogle, newLinkCode } from "./reschedule";
import { notifyUser } from "./notify";
import type { CalendarApi } from "./sync/types";

export type StaffVisitInput = {
  requestId: string;
  clientName: string;
  externalRef?: string;
  phoneRaw?: string;
  propertyCodes: string;
  consultantId: string;
  scheduledStart: string;
  durationMinutes: number;
  note?: string;
  allowOverlap?: boolean;
};

export async function createStaffVisit(actor: AuthzActor, input: StaffVisitInput, now = new Date(), opts: { calendarApi?: CalendarApi } = {}) {
  assert(isPreService(actor) || hasGlobalView(actor));
  const errors: Record<string, string> = {};
  const name = input.clientName.replace(/\s+/g, " ").trim().slice(0, 160);
  if (name.length < 2) errors.clientName = "Informe o nome do cliente.";
  const codes = [...new Set(input.propertyCodes.split(/[;,\s]+/).map((c) => c.trim()).filter(Boolean))];
  if (!codes.length || codes.length > 6 || codes.some((c) => !/^[0-9A-Za-z-]{2,40}$/.test(c))) errors.propertyCodes = "Informe o código do imóvel (vários: separe com ;).";
  const ref = (input.externalRef ?? "").replace(/\D/g, "").slice(0, 12) || null;
  const phone = input.phoneRaw?.trim() ? normalizePhone(input.phoneRaw) : null;
  if (phone && !phone.valid) errors.phoneRaw = "Telefone inválido (DDD + número) ou deixe em branco.";
  const start = fromLocalInput(input.scheduledStart);
  if (!start) errors.scheduledStart = "Informe data e horário.";
  else if (start.getTime() < now.getTime() - 5 * 60_000) errors.scheduledStart = "Escolha um horário a partir de agora.";
  if (Object.keys(errors).length) throw new AppError("VALIDATION", "Revise os campos destacados.", errors);
  const consultant = await db.user.findUnique({ where: { id: input.consultantId } });
  if (!consultant || consultant.role !== "CONSULTANT" || !consultant.active) throw new AppError("VALIDATION", "Escolha a consultora.", { consultantId: "Consultora inválida." });
  const minutes = Math.min(600, Math.max(15, Math.round(input.durationMinutes || 60)));
  const end = new Date(start!.getTime() + minutes * 60_000);
  const requestId = `staff-${input.requestId}`.slice(0, 100);
  const dup = await db.visit.findUnique({ where: { createRequestId: requestId } });
  if (dup) return { visit: dup, google: dup.googleCreatedAt ? ("created" as const) : ("already" as const) };
  if (!input.allowOverlap) await assertNoOverlap(consultant.id, start!, end);

  const visit = await db.$transaction(async (tx) => {
    const link = await resolveClient(tx, { clientName: name, phoneRaw: input.phoneRaw?.trim() || null });
    const [code, ...extra] = codes;
    const shared = {
      scheduledStart: start!,
      scheduledEnd: end,
      clientName: name,
      phoneRaw: input.phoneRaw?.trim() || null,
      phoneNormalized: phone?.normalized ?? null,
      externalRef: ref,
      consultantId: consultant.id,
      assignmentStatus: "MANUAL" as const,
      assignmentNote: "PRE_ATENDIMENTO",
      ...link,
    };
    const v = await tx.visit.create({ data: { origin: "MANUAL", createRequestId: requestId, propertyCode: code, propertyId: await ensureProperty(tx, code), linkCode: newLinkCode(), ...shared } });
    for (const c of extra) await tx.visit.create({ data: { origin: "MANUAL", companionOfId: v.id, propertyCode: c, propertyId: await ensureProperty(tx, c), ...shared } });
    await audit(tx, { actorId: actor.id, action: "visit.scheduled_by_staff", entityType: "Visit", entityId: v.id, changes: { consultora: consultant.id, imoveis: codes, inicio: start!.toISOString() } });
    return v;
  });
  const google = await createVisitEventInGoogle(actor, visit.id, { calendarApi: opts.calendarApi, extraNote: input.note }).catch(() => "error" as const);
  await notifyUser(consultant.id, {
    title: `Nova visita: ${fmt.shortDate(start!)} às ${fmt.time(start!)}`,
    body: `${name.split(" ")[0]} · imóvel ${codes.join(", ")}. Agendada pelo pré-atendimento.`,
    url: `/visitas/${visit.id}`,
    tag: `visita-${visit.id}`,
  }).catch(() => undefined);
  return { visit, google };
}
