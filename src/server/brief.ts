/**
 * "Antes de entrar": ficha rápida da visita para a consultora chegar preparada.
 * - Imóvel: valores, área, quartos, bairro e fotos do anúncio.
 * - Cliente: visitas anteriores DENTRO do escopo de quem vê (consultora: só as dela — mesma regra das revisitas).
 * - Imóvel na equipe: só números e motivos padronizados (sem nomes nem observações de outras pessoas).
 * - Pontos para a conversa: comparações determinísticas (preço, tamanho, bairro) com o que o cliente já recusou.
 */
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { assert, canViewVisit, opportunityScope, visitScope, type AuthzActor } from "@/lib/authz";
import { normalizeText } from "@/lib/text";
import { notDemo } from "./demo";

const propSelect = {
  code: true,
  title: true,
  category: true,
  neighborhood: true,
  city: true,
  rent: true,
  condoFee: true,
  iptu: true,
  totalPrice: true,
  area: true,
  bedrooms: true,
  photoUrl: true,
  photos: true,
  address: true,
} as const;

type Prop = { code: string; neighborhood: string | null; rent: number | null; totalPrice: number | null; area: number | null; bedrooms: number | null };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const cost = (p: Prop | null | undefined) => p?.totalPrice ?? p?.rent ?? null;

/** Compara o imóvel de hoje com um que o cliente recusou, pelo motivo dado. */
export function compareWithRejected(cur: Prop | null, prev: Prop | null, reason: string | null): string | null {
  if (!prev) return null;
  if (cur && prev.code === cur.code) return reason ? `Já visitou este mesmo imóvel e recusou por “${reason}”. Descubra o que mudou para ele voltar.` : "Já visitou este mesmo imóvel antes.";
  const r = normalizeText(reason);
  const label = `o ${prev.code}`;
  if (/preco|valor|caro|custo|condominio|aluguel/.test(r)) {
    const a = cost(cur);
    const b = cost(prev);
    if (a && b) {
      const d = a - b;
      if (Math.abs(d) < 50) return `Achou caro ${label} (${brl(b)}). Este tem valor parecido (${brl(a)}) — prepare o argumento.`;
      return d < 0 ? `Achou caro ${label} (${brl(b)}). Este sai ${brl(-d)} mais barato (${brl(a)}).` : `Achou caro ${label} (${brl(b)}). Este é ${brl(d)} mais caro (${brl(a)}) — destaque o que ele tem a mais.`;
    }
    return `Achou caro ${label}. Confirme o orçamento logo no início.`;
  }
  if (/tamanho|pequen|espaco|planta|quarto|distribu/.test(r)) {
    if (cur?.area && prev.area) {
      const d = cur.area - prev.area;
      return d > 0 ? `Achou ${label} pequeno (${prev.area} m²). Este tem ${cur.area} m² (+${d} m²).` : `Achou ${label} pequeno (${prev.area} m²). Este tem ${cur.area} m² — mostre bem a distribuição.`;
    }
    if (cur?.bedrooms && prev.bedrooms) return `Achou ${label} pequeno (${prev.bedrooms} quartos). Este tem ${cur.bedrooms}.`;
    return `Achou ${label} pequeno. Mostre bem a distribuição dos ambientes.`;
  }
  if (/localiza|bairro|regiao|longe|distan/.test(r)) {
    if (cur?.neighborhood && prev.neighborhood) {
      return cur.neighborhood === prev.neighborhood
        ? `Não gostou da localização do ${prev.code} — este fica no mesmo bairro (${cur.neighborhood}). Pergunte o que pesou.`
        : `Não gostou da localização do ${prev.code} (${prev.neighborhood}). Este fica em ${cur.neighborhood}.`;
    }
    return `Não gostou da localização do ${prev.code}. Pergunte o que é importante perto de casa.`;
  }
  return reason ? `Recusou ${label}: “${reason}”.` : null;
}

export async function visitBrief(actor: AuthzActor, visitId: string) {
  const visit = await db.visit.findUnique({
    where: { id: visitId },
    select: { id: true, consultantId: true, clientId: true, propertyCode: true, scheduledStart: true, property: { select: propSelect } },
  });
  if (!visit) throw notFound();
  assert(canViewVisit(actor, visit));
  const code = visit.propertyCode;
  const prop = visit.property;

  const [history, team, opp] = await Promise.all([
    visit.clientId
      ? db.visit.findMany({
          where: { ...visitScope(actor), clientId: visit.clientId, id: { not: visit.id }, excluded: false, scheduledStart: { lt: visit.scheduledStart } },
          orderBy: { scheduledStart: "desc" },
          take: 8,
          select: { id: true, scheduledStart: true, status: true, evaluation: true, note: true, propertyCode: true, negativeReason: { select: { label: true } }, property: { select: propSelect } },
        })
      : Promise.resolve([]),
    code
      ? db.visit.findMany({
          where: { ...notDemo, propertyCode: code, excluded: false, status: { in: ["DONE", "NO_SHOW"] }, id: { not: visit.id } },
          select: { status: true, evaluation: true, negativeReason: { select: { label: true } } },
        })
      : Promise.resolve([]),
    visit.clientId && code
      ? db.opportunity.findFirst({ where: { ...opportunityScope(actor), clientId: visit.clientId, property: { code }, status: { in: ["FOLLOW_UP", "DOCS_REVIEW"] } }, select: { id: true, status: true, createdAt: true } })
      : Promise.resolve(null),
  ]);

  // imóvel na equipe (números)
  const done = team.filter((v) => v.status === "DONE");
  const negatives = done.filter((v) => v.evaluation === "NEGATIVE");
  const reasonCount = new Map<string, number>();
  for (const v of negatives) if (v.negativeReason) reasonCount.set(v.negativeReason.label, (reasonCount.get(v.negativeReason.label) ?? 0) + 1);
  const topReason = [...reasonCount.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const stats = {
    done: done.length,
    positive: done.filter((v) => v.evaluation === "POSITIVE").length,
    negative: negatives.length,
    noShow: team.filter((v) => v.status === "NO_SHOW").length,
    topReason: topReason ? { label: topReason[0], count: topReason[1] } : null,
  };

  // pontos para a conversa
  const points: { tone: "good" | "warn" | "info"; text: string }[] = [];
  const realized = history.filter((h) => h.status === "DONE");
  for (const h of realized.filter((x) => x.evaluation === "NEGATIVE").slice(0, 2)) {
    const t = compareWithRejected(prop, h.property, h.negativeReason?.label ?? null);
    if (t) points.push({ tone: /mais barato|\+\d+ m²|Este tem \d+ quartos|Este fica em/.test(t) ? "good" : "warn", text: t });
  }
  const undecided = realized.find((h) => h.evaluation === "UNDECIDED");
  if (undecided) points.push({ tone: "info", text: `Ficou em dúvida no ${undecided.propertyCode ?? "imóvel anterior"} — pergunte se ainda está procurando e o que faltou.` });
  const liked = realized.find((h) => h.evaluation === "POSITIVE" && h.propertyCode !== code);
  if (liked) points.push({ tone: "info", text: `Gostou do ${liked.propertyCode} — compare os dois com ele.` });
  if (history.some((h) => h.status === "NO_SHOW")) points.push({ tone: "warn", text: "Já faltou a uma visita marcada — vale confirmar a presença antes de sair." });
  if (stats.topReason && stats.topReason.count >= 2) {
    points.push({ tone: "warn", text: `Outros visitantes citaram “${stats.topReason.label}” (${stats.topReason.count} de ${stats.negative} negativas). Antecipe essa objeção.` });
  } else if (stats.done >= 3 && stats.positive / stats.done >= 0.5) {
    points.push({ tone: "good", text: `Imóvel com boa aceitação: ${stats.positive} de ${stats.done} visitantes gostaram.` });
  }
  if (opp) points.push({ tone: "info", text: opp.status === "DOCS_REVIEW" ? "Documentação deste imóvel já está em análise." : "Já há acompanhamento aberto deste cliente com este imóvel." });
  if (!history.length && visit.clientId) points.push({ tone: "info", text: "Primeira visita deste cliente com você." });

  return { property: prop, history, stats, points, opportunity: opp };
}

export type VisitBriefData = Awaited<ReturnType<typeof visitBrief>>;
