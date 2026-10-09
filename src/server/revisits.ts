/**
 * Revisita: o cliente já tinha visita realizada antes desta (com a mesma ou outra consultora).
 * Calculado na leitura para refletir resultados registrados depois do agendamento.
 * Privacidade: as visitas anteriores consideradas respeitam o escopo de quem consulta
 * (consultora: só as próprias; gestão: equipe toda) — cliente compartilhado não revela histórico alheio.
 */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export type Revisit = {
  /** visitas realizadas anteriores deste cliente */
  previous: number;
  /** alguma delas foi no mesmo imóvel */
  sameProperty: boolean;
  lastDoneAt: Date;
};

type Item = { id: string; clientId: string | null; phoneNormalized: string | null; propertyCode: string | null; scheduledStart: Date };
type DoneVisit = Item;

/** Regra pura: casa por cliente (ou telefone validado, quando ainda sem vínculo) e considera só visitas realizadas antes. */
export function computeRevisit(v: Item, done: DoneVisit[]): Revisit | null {
  const prior = done.filter(
    (d) =>
      d.id !== v.id &&
      d.scheduledStart < v.scheduledStart &&
      ((v.clientId && d.clientId === v.clientId) || (v.phoneNormalized && d.phoneNormalized === v.phoneNormalized)),
  );
  if (!prior.length) return null;
  return {
    previous: prior.length,
    sameProperty: !!v.propertyCode && prior.some((d) => d.propertyCode === v.propertyCode),
    lastDoneAt: new Date(Math.max(...prior.map((d) => d.scheduledStart.getTime()))),
  };
}

/** `scope`: filtro de autorização de quem está vendo (use visitScope(actor)). */
export async function withRevisits<T extends Item>(items: T[], scope: Prisma.VisitWhereInput): Promise<(T & { revisit: Revisit | null })[]> {
  const clientIds = [...new Set(items.map((v) => v.clientId).filter((x): x is string => !!x))];
  const phones = [...new Set(items.map((v) => v.phoneNormalized).filter((x): x is string => !!x))];
  if (!clientIds.length && !phones.length) return items.map((v) => ({ ...v, revisit: null }));
  const latest = new Date(Math.max(...items.map((v) => v.scheduledStart.getTime())));
  const done = await db.visit.findMany({
    where: {
      ...scope,
      status: "DONE",
      excluded: false,
      scheduledStart: { lt: latest },
      OR: [...(clientIds.length ? [{ clientId: { in: clientIds } }] : []), ...(phones.length ? [{ phoneNormalized: { in: phones } }] : [])],
    },
    select: { id: true, clientId: true, phoneNormalized: true, propertyCode: true, scheduledStart: true },
  });
  return items.map((v) => ({ ...v, revisit: computeRevisit(v, done) }));
}
