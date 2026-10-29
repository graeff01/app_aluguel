/**
 * Leitura de mercado da captação: o que o mercado oferece para o que o cliente pede ("tem, mas acima desse valor",
 * "nesse valor só com menos quartos"…). Dois níveis:
 * - parecer em um pedido do radar (o pré-atendimento é avisado e usa na conversa com o cliente);
 * - leitura por perfil (bairro + tipo), que aparece no mapa da demanda e em todo pedido / cliente em busca com esse
 *   perfil — inclusive para as consultoras argumentarem com o cliente.
 * Só perfis e observações de mercado: nenhum dado de cliente.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assert, hasGlobalView, isCapture, type AuthzActor } from "@/lib/authz";
import { MARKET_TAGS, type MarketTag } from "@/lib/market-tags";
import { notifyUser } from "./notify";
import { parseMoney } from "./pre-analysis";
import { normText } from "./site-search";

export const canWriteMarket = (a: AuthzActor) => isCapture(a) || hasGlobalView(a);
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Input = { tag: string; text?: string; realistic?: string };

function parseInput(input: Input) {
  if (!(input.tag in MARKET_TAGS)) throw new AppError("VALIDATION", "Escolha a leitura de mercado.", { tag: "Obrigatório." });
  const text = (input.text ?? "").trim().slice(0, 600);
  let cents: number | null = null;
  if (input.realistic?.trim()) {
    cents = parseMoney(input.realistic);
    if (!cents || cents < 30000 || cents > 10_000_000) throw new AppError("VALIDATION", "Valor inválido. Ex.: 2.800", { realistic: "Valor inválido." });
  }
  return { tag: input.tag as MarketTag, text, cents };
}

/** Frase da leitura: "Tem, mas acima desse valor — normalmente a partir de R$ 2.800. Texto". */
export const marketLine = (n: { tag: string; text?: string | null; cents?: number | null }) =>
  [MARKET_TAGS[n.tag as MarketTag] ?? n.tag, n.cents ? `valor realista: ${brl(n.cents)}` : null, n.text?.trim() || null].filter(Boolean).join(" — ");

/** Parecer da captação em um pedido do radar. */
export async function setRadarMarketNote(actor: AuthzActor, radarId: string, input: Input, now = new Date(), notify: typeof notifyUser = notifyUser) {
  assert(canWriteMarket(actor));
  const n = parseInput(input);
  const r = await db.clientRadar.findUnique({ where: { id: radarId } });
  if (!r || !r.sentToCaptureAt) throw notFound();
  if (r.status === "CLOSED") throw new AppError("INVALID_STATE", "Este pedido já foi encerrado pelo pré-atendimento.");
  await db.$transaction(async (tx) => {
    await tx.clientRadar.update({ where: { id: radarId }, data: { marketTag: n.tag, marketNote: n.text || null, marketCents: n.cents, marketNoteAt: now, marketNoteById: actor.id, lastUpdateAt: now } });
    await tx.radarEvent.create({ data: { radarId, authorId: actor.id, createdAt: now, note: `Parecer da captação: ${marketLine(n)}` } });
    await audit(tx, { actorId: actor.id, action: "radar.market_note", entityType: "ClientRadar", entityId: radarId, changes: { leitura: n.tag } });
  });
  const pre = await db.user.findMany({ where: { role: "PRE_SERVICE", active: true }, select: { id: true } });
  for (const u of pre) await notify(u.id, { title: "Parecer da captação em um pedido", body: `${MARKET_TAGS[n.tag]}. Toque para ver e conversar com o cliente.`, url: `/radar/${radarId}`, tag: `radar-parecer-${radarId}` }).catch(() => undefined);
}

/** Leitura de mercado de um perfil (bairro + tipo); grava ou atualiza. */
export async function upsertMarketNote(actor: AuthzActor, input: Input & { area: string; type?: string | null }) {
  assert(canWriteMarket(actor));
  const n = parseInput(input);
  const area = input.area.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!area) throw new AppError("VALIDATION", "Bairro inválido.");
  const type = input.type?.trim() || null;
  const key = { areaKey: normText(area), typeKey: type ? normText(type) : "" };
  await db.$transaction(async (tx) => {
    const row = await tx.marketNote.upsert({ where: { areaKey_typeKey: key }, update: { tag: n.tag, text: n.text, cents: n.cents, authorId: actor.id, area, type }, create: { ...key, area, type, tag: n.tag, text: n.text, cents: n.cents, authorId: actor.id } });
    await audit(tx, { actorId: actor.id, action: "market_note.saved", entityType: "MarketNote", entityId: row.id, changes: { bairro: area, tipo: type, leitura: n.tag } });
  });
}

export async function deleteMarketNote(actor: AuthzActor, id: string) {
  assert(canWriteMarket(actor));
  await db.marketNote.delete({ where: { id } }).catch(() => undefined);
}

export type MarketNoteRow = Awaited<ReturnType<typeof db.marketNote.findMany>>[number] & { author: string | null };

/** Todas as leituras (tabela pequena), com o nome de quem escreveu. */
export async function listMarketNotes(): Promise<MarketNoteRow[]> {
  const rows = await db.marketNote.findMany({ orderBy: { updatedAt: "desc" } });
  const ids = [...new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x))];
  const names = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, author: r.authorId ? (names.get(r.authorId) ?? null) : null }));
}

/** Leituras que valem para um perfil: mesmo bairro e (mesmo tipo ou qualquer tipo). */
export function notesForProfile(notes: MarketNoteRow[], p: { areas: string[]; propertyType: string | null }) {
  const areas = new Set(p.areas.map(normText));
  const type = p.propertyType ? normText(p.propertyType) : null;
  return notes.filter((n) => areas.has(n.areaKey) && (n.typeKey === "" || (type !== null && n.typeKey === type)));
}

/** Leitura de um segmento do mapa (bairro + tipo exatos; senão a do bairro para qualquer tipo). */
export function noteForSegment<N extends { areaKey: string; typeKey: string }>(notes: N[], area: string, type: string | null): N | undefined {
  const a = normText(area);
  const t = type ? normText(type) : "";
  return notes.find((n) => n.areaKey === a && n.typeKey === t) ?? notes.find((n) => n.areaKey === a && n.typeKey === "");
}
