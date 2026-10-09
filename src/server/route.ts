/**
 * Rota do dia: visitas da consultora em ordem de horário, com endereço do imóvel,
 * intervalo entre visitas e link único para o Google Maps (saindo da localização atual).
 * Escopo: consultora vê só a própria rota; gestão escolhe a consultora.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { cleanAddress, mapsRouteUrl, routeQuery } from "@/lib/address";
import { dayKey, endOfDayInTz, startOfDayInTz } from "@/lib/time";

/** Abaixo disso, entre bairros diferentes, o intervalo é marcado como apertado. */
export const TIGHT_GAP_MIN = 20;

export async function dayRoute(actor: AuthzActor, opts: { day?: string; consultantId?: string | null } = {}, now = new Date()) {
  const global = hasGlobalView(actor);
  const day = opts.day ?? dayKey(now);
  const consultants = global
    ? await db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];
  let consultantId = global ? (opts.consultantId ?? null) : actor.id;
  if (global && consultantId && !consultants.some((c) => c.id === consultantId)) consultantId = null;
  if (global && !consultantId) {
    // padrão: a primeira consultora com visitas no dia
    const first = await db.visit.findFirst({
      where: { consultantId: { in: consultants.map((c) => c.id) }, excluded: false, scheduledStart: { gte: startOfDayInTz(day), lt: endOfDayInTz(day) } },
      orderBy: { scheduledStart: "asc" },
      select: { consultantId: true },
    });
    consultantId = first?.consultantId ?? consultants[0]?.id ?? null;
  }
  if (!consultantId) return { day, consultantId: null, consultants, stops: [], routeUrl: null, remaining: 0, missing: 0 };

  const visits = await db.visit.findMany({
    where: {
      consultantId,
      excluded: false,
      status: { in: ["SCHEDULED", "DONE", "NO_SHOW"] },
      scheduledStart: { gte: startOfDayInTz(day), lt: endOfDayInTz(day) },
    },
    orderBy: { scheduledStart: "asc" },
    select: {
      id: true,
      scheduledStart: true,
      scheduledEnd: true,
      clientName: true,
      phoneNormalized: true,
      propertyCode: true,
      status: true,
      evaluation: true,
      property: { select: { code: true, address: true, addressSource: true, neighborhood: true, city: true, category: true, photoUrl: true, title: true } },
    },
  });

  const stops = visits.map((v, i) => {
    const prev = visits[i - 1];
    const loc = routeQuery(v.property);
    const gapMin = prev ? Math.round((v.scheduledStart.getTime() - prev.scheduledEnd.getTime()) / 60_000) : null;
    const sameProperty = !!prev && !!v.propertyCode && prev.propertyCode === v.propertyCode;
    const sameArea = !!prev && !!v.property?.neighborhood && prev.property?.neighborhood === v.property.neighborhood;
    const pending = v.status === "SCHEDULED" && v.scheduledEnd > now;
    return {
      ...v,
      loc,
      gapMin,
      sameProperty,
      sameArea,
      tight: gapMin !== null && !sameProperty && !sameArea && gapMin < TIGHT_GAP_MIN,
      overlap: gapMin !== null && gapMin < 0,
      pending,
    };
  });
  // rota a partir de agora: só as próximas, sem repetir o mesmo endereço em sequência
  const next = stops.filter((s) => s.pending && s.loc);
  const queries = next.map((s) => s.loc!.query).filter((q, i, a) => i === 0 || a[i - 1] !== q);
  return {
    day,
    consultantId,
    consultants,
    stops,
    routeUrl: mapsRouteUrl(queries.map((query) => ({ query }))),
    remaining: next.length,
    missing: stops.filter((s) => s.pending && !s.loc).length,
  };
}

/** Quem pode informar o endereço: gestão, ou a consultora com visita naquele imóvel (se correções estiverem liberadas). */
export async function canEditPropertyAddress(actor: AuthzActor, code: string) {
  if (hasGlobalView(actor)) return true;
  const s = await getSettings();
  if (!s.consultantCanCorrectData) return false;
  return (await db.visit.count({ where: { consultantId: actor.id, propertyCode: code } })) > 0;
}

export async function setPropertyAddress(actor: AuthzActor, code: string, raw: string) {
  assert(await canEditPropertyAddress(actor, code));
  const prop = await db.property.findUnique({ where: { code } });
  if (!prop) throw new AppError("NOT_FOUND", "Imóvel não encontrado.");
  const trimmed = raw.trim();
  const address = trimmed ? cleanAddress(trimmed) : null;
  if (trimmed && !address) throw new AppError("VALIDATION", "Informe um endereço válido (rua, número e bairro).", { address: "Endereço inválido." });
  await db.$transaction(async (tx) => {
    await tx.property.update({
      where: { id: prop.id },
      // apagar devolve o controle para a agenda
      data: { address, addressSource: address ? "MANUAL" : null, addressUpdatedAt: new Date() },
    });
    await audit(tx, { actorId: actor.id, action: "property.address_set", entityType: "Property", entityId: prop.id, changes: { codigo: code, de: prop.address, para: address } });
  });
  return address ? "Endereço salvo." : "Endereço removido.";
}
