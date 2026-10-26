/**
 * Editar a visita pela agenda do sistema (pré-atendimento e gestão): dia e horário, cliente, telefone, nº do
 * atendimento, consultora e mais imóveis. Vale para todos os imóveis em aberto da mesma visita, e o mesmo evento
 * da agenda Google é atualizado. Horário de visita ligada à agenda só muda se o Google aceitar
 * (senão a próxima leitura da agenda voltaria o horário antigo).
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, hasGlobalView, isPreService, type AuthzActor } from "@/lib/authz";
import { normalizePhone } from "@/lib/phone";
import { cleanOptional } from "@/lib/text";
import { fromLocalInput } from "@/lib/time";
import { notifyUser } from "./notify";
import type { CalendarApi } from "./sync/types";
import { canEditInGoogle, pushVisitChange, type GoogleWrite } from "./google-write";
import { resolveClient, cleanupOrphanClient } from "./clients";
import { ensureProperty } from "./visits";
import { assertNoOverlap } from "./reschedule";

export type StaffEditInput = {
  expectedVersion: number;
  clientName: string;
  externalRef?: string;
  phoneRaw: string;
  /** YYYY-MM-DD e HH:MM (horário de Brasília) */
  date: string;
  time: string;
  durationMinutes: number;
  consultantId: string;
  /** imóveis a acrescentar na visita ("123;456") */
  addCodes?: string;
  allowOverlap?: boolean;
};

const MAX_CODES = 6;

export async function staffEditVisit(actor: AuthzActor, visitId: string, input: StaffEditInput, opts: { calendarApi?: CalendarApi } = {}) {
  assert(isPreService(actor) || hasGlobalView(actor));
  const visit = await db.visit.findUnique({ where: { id: visitId } });
  if (!visit || visit.excluded) throw notFound();
  if (visit.status !== "SCHEDULED") throw new AppError("INVALID_STATE", "Esta visita já tem resultado registrado: não dá para editar.");
  if (visit.version !== input.expectedVersion) throw new AppError("CONFLICT", "A visita mudou enquanto a tela estava aberta (agenda ou outra pessoa). Abra de novo para editar.");
  const groupId = visit.companionOfId ?? visit.id;
  const group = await db.visit.findMany({ where: { excluded: false, OR: [{ id: groupId }, { companionOfId: groupId }] }, orderBy: { createdAt: "asc" } });
  const primary = group.find((v) => v.id === groupId) ?? visit;
  const open = group.filter((v) => v.status === "SCHEDULED");

  const clientName = cleanOptional(input.clientName);
  if (!clientName) throw new AppError("VALIDATION", "Informe o nome do cliente.", { clientName: "Obrigatório." });
  const phoneRaw = cleanOptional(input.phoneRaw) ?? null;
  const externalRef = cleanOptional(input.externalRef)?.slice(0, 40) ?? null;
  const start = fromLocalInput(`${input.date}T${input.time}`);
  if (!start) throw new AppError("VALIDATION", "Informe dia e horário.", { scheduledStart: "Data inválida." });
  const minutes = Math.min(600, Math.max(15, Math.round(input.durationMinutes || 60)));
  const end = new Date(start.getTime() + minutes * 60_000);
  const timeChanged = start.getTime() !== visit.scheduledStart.getTime() || end.getTime() !== visit.scheduledEnd.getTime();
  const consultant = await db.user.findUnique({ where: { id: input.consultantId } });
  if (!consultant || consultant.role !== "CONSULTANT" || !consultant.active) throw new AppError("VALIDATION", "Escolha a consultora.", { consultantId: "Obrigatório." });
  const consultantChanged = consultant.id !== visit.consultantId;

  // imóveis novos: os que já estão em aberto na visita são ignorados
  const openCodes = new Set(open.map((v) => v.propertyCode).filter(Boolean));
  const addCodes = [...new Set((input.addCodes ?? "").split(/[;,\s]+/).map((c) => c.trim()).filter(Boolean))].filter((c) => !openCodes.has(c));
  if (addCodes.some((c) => !/^[0-9A-Za-z-]{2,40}$/.test(c))) throw new AppError("VALIDATION", "Confira o código do imóvel.", { addCodes: "Código inválido (vários: separe com ;)." });
  if (openCodes.size + addCodes.length > MAX_CODES) throw new AppError("VALIDATION", `No máximo ${MAX_CODES} imóveis na mesma visita.`, { addCodes: "Imóveis demais." });

  // horário de visita ligada a um evento: precisa conseguir mudar o evento (a agenda manda no horário)
  const linked = !!primary.sourceEventId;
  if (timeChanged && linked && !opts.calendarApi && !(await canEditInGoogle(primary.id))) {
    throw new AppError("VALIDATION", "O app não tem permissão para mudar o horário na agenda Google: mude o horário no evento da agenda.", { scheduledStart: "Mude na agenda Google." });
  }
  if ((timeChanged || consultantChanged) && !input.allowOverlap) await assertNoOverlap(consultant.id, start, end, group.map((v) => v.id));

  const before = { start: visit.scheduledStart, end: visit.scheduledEnd, consultantId: visit.consultantId };
  const actorName = (await db.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name.split(" ")[0] ?? "a equipe";
  const r = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id = ${visitId} FOR UPDATE`;
    const fresh = await tx.visit.findUnique({ where: { id: visitId } });
    if (!fresh || fresh.version !== input.expectedVersion || fresh.status !== "SCHEDULED") throw new AppError("CONFLICT", "A visita mudou enquanto a tela estava aberta (agenda ou outra pessoa). Abra de novo para editar.");
    const changed = new Set<string>();
    for (const v of open) {
      const data: Record<string, unknown> = {};
      const manual = new Set(v.manualFields);
      if (clientName !== v.clientName) {
        data.clientName = clientName;
        manual.add("clientName");
        changed.add("cliente");
      }
      if (phoneRaw !== v.phoneRaw) {
        Object.assign(data, { phoneRaw, phoneNormalized: normalizePhone(phoneRaw).normalized });
        manual.add("phone");
        changed.add("telefone");
      }
      if (externalRef !== v.externalRef) {
        data.externalRef = externalRef;
        changed.add("atendimento");
      }
      if (timeChanged) {
        Object.assign(data, { scheduledStart: start, scheduledEnd: end });
        changed.add("horário");
      }
      if (consultant.id !== v.consultantId) {
        Object.assign(data, { consultantId: consultant.id, assignmentStatus: "MANUAL" });
        manual.add("consultantId");
        changed.add("consultora");
      }
      if (("clientName" in data || "phoneRaw" in data) && v.clientMatch !== "CONFIRMED_MANUAL") {
        Object.assign(data, await resolveClient(tx, { clientName, phoneRaw, currentClientId: v.clientId }));
      }
      if (!Object.keys(data).length) continue;
      await tx.visit.update({ where: { id: v.id }, data: { ...data, manualFields: [...manual], version: { increment: 1 } } });
      if ("clientId" in data && data.clientId !== v.clientId) await cleanupOrphanClient(tx, v.clientId);
    }
    // imóveis a mais: entram como acompanhantes da visita (um cartão para cada); "propertyCode" manual:
    // a sincronização não os cancela se o título da agenda ainda não tiver o código
    const added: string[] = [];
    // cliente já ligado de novo acima (nome/telefone podem ter mudado)
    const cur = addCodes.length ? await tx.visit.findUniqueOrThrow({ where: { id: visitId }, select: { clientId: true, clientMatch: true } }) : null;
    for (const code of addCodes) {
      const old = group.find((s) => s.propertyCode === code && s.status === "CANCELED" && s.id !== groupId && !s.swappedTo);
      const shared = {
        status: "SCHEDULED" as const,
        scheduledStart: start,
        scheduledEnd: end,
        clientName,
        phoneRaw,
        phoneNormalized: normalizePhone(phoneRaw).normalized,
        externalRef,
        clientId: cur?.clientId ?? null,
        clientMatch: cur?.clientMatch ?? visit.clientMatch,
        consultantId: consultant.id,
        assignmentStatus: consultantChanged ? ("MANUAL" as const) : visit.assignmentStatus,
        assignmentNote: visit.assignmentNote,
        scheduledById: visit.scheduledById,
        confirmStatus: visit.confirmStatus,
      };
      const v = old
        ? await tx.visit.update({ where: { id: old.id }, data: { ...shared, cancelReasonId: null, note: null, concludedAt: null, concludedById: null, autoCanceled: false, manualFields: [...new Set([...old.manualFields, "propertyCode"])], version: { increment: 1 } } })
        : await tx.visit.create({ data: { ...shared, origin: visit.origin, companionOfId: groupId, propertyCode: code, propertyId: await ensureProperty(tx, code), manualFields: ["propertyCode", ...(consultantChanged ? ["consultantId"] : [])] } });
      await tx.visitOutcomeHistory.create({ data: { visitId: v.id, status: "SCHEDULED", note: `Imóvel ${code} adicionado à visita por ${actorName}`, authorId: actor.id } });
      added.push(code);
    }
    if (added.length) changed.add("imóveis");
    if (changed.size) await audit(tx, { actorId: actor.id, action: "visit.staff_edited", entityType: "Visit", entityId: groupId, changes: { campos: [...changed], imoveisNovos: added } });
    return { changed, added };
  });
  if (!r.changed.size) return { changed: [] as string[], added: [] as string[], google: "updated" as GoogleWrite };

  // o mesmo evento na agenda Google (pelo id de uma visita em aberto: a principal pode estar cancelada)
  const titleChanged = ["cliente", "telefone", "atendimento", "imóveis"].some((k) => r.changed.has(k));
  const google = await pushVisitChange(open[0]?.id ?? visit.id, { time: timeChanged, title: titleChanged, ...(consultantChanged ? { consultant: { from: before.consultantId, to: consultant.id } } : {}) }, opts.calendarApi);
  if (timeChanged && linked && google !== "updated") {
    // não mudou no Google: volta o horário (senão a próxima leitura da agenda desfaria sozinha)
    await db.visit.updateMany({ where: { OR: [{ id: groupId }, { companionOfId: groupId }], status: "SCHEDULED" }, data: { scheduledStart: before.start, scheduledEnd: before.end } });
    throw new AppError("INVALID_STATE", google === "not_owner" ? "O evento é da consultora: o horário precisa ser mudado na agenda dela. Os outros dados foram salvos." : "Não consegui mudar o horário na agenda Google agora. Os outros dados foram salvos; tente o horário de novo.");
  }

  const when = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(start);
  const what = [timeChanged ? `novo horário: ${when}` : "", r.added.length ? `imóvel ${r.added.join(", ")} adicionado` : ""].filter(Boolean).join(" · ");
  if (consultantChanged) {
    await notifyUser(consultant.id, { title: `Nova visita para você · ${when}`, body: `${clientName}${open[0]?.propertyCode ? ` · imóvel ${open[0].propertyCode}` : ""}. Passada pelo pré-atendimento.`, url: `/visitas/${open[0]?.id ?? visit.id}`, tag: `editada-${groupId}` }).catch(() => undefined);
    if (before.consultantId && before.consultantId !== actor.id) await notifyUser(before.consultantId, { title: "Visita passada para outra consultora", body: `${clientName} · ${when}.`, url: "/minhas", tag: `editada-${groupId}` }).catch(() => undefined);
  } else if (what && consultant.id !== actor.id) {
    await notifyUser(consultant.id, { title: `Visita de ${clientName} alterada`, body: `${what[0].toUpperCase()}${what.slice(1)}.`, url: `/visitas/${open[0]?.id ?? visit.id}`, tag: `editada-${groupId}` }).catch(() => undefined);
  }
  return { changed: [...r.changed], added: r.added, google };
}
