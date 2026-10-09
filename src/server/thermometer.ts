/**
 * Termômetro do imóvel: quais imóveis estão encalhando e por quê.
 * Regras determinísticas (sem IA), sempre com o volume ao lado da taxa.
 * Comparação com imóveis parecidos: mesmo bairro e tipo, aluguel até 25% acima ou abaixo.
 */
import { db } from "@/lib/db";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { rate, type Rate } from "@/lib/metrics";
import { normalizeText } from "@/lib/text";
import { notDemo } from "./demo";

const DAY = 86400_000;
export const THERMO_DAYS = 90;

export type ThermoLevel = "stuck" | "attention" | "healthy" | "low_data";
export const THERMO_LABEL: Record<ThermoLevel, string> = {
  stuck: "Encalhado",
  attention: "Atenção",
  healthy: "Saudável",
  low_data: "Poucas visitas",
};

type Counts = { done: number; positive: number; negative: number; undecided: number; noShow: number };
export type ReasonCount = { label: string; count: number };

/** Sugestão objetiva a partir do motivo mais citado. */
export function suggestionFor(reason: string | null, level: ThermoLevel): string {
  if (level === "low_data") return "Ainda são poucas visitas para concluir; acompanhe as próximas.";
  if (level === "healthy") return "Interesse dentro do esperado; manter o anúncio como está.";
  const r = normalizeText(reason);
  if (r) {
    if (/preco|valor|caro|aluguel|condominio|iptu|custo/.test(r)) return "Conversar com o proprietário sobre o valor do aluguel.";
    if (/estado|conserv|reforma|manuten|limp|pintura|mofo|umid|velho|antigo/.test(r)) return "Avaliar manutenção ou limpeza antes das próximas visitas.";
    if (/localiza|bairro|regiao|seguranca|barulho|transito|distan/.test(r)) return "Deixar a localização mais clara no anúncio para filtrar as visitas.";
    if (/tamanho|pequen|espaco|planta|quarto|metrag/.test(r)) return "Revisar fotos e metragem do anúncio para alinhar a expectativa.";
    if (/vaga|garagem|estaciona/.test(r)) return "Deixar clara a situação da vaga de garagem no anúncio.";
    if (/pet|animal|cachorro|gato/.test(r)) return "Confirmar com o proprietário se aceita animais e informar no anúncio.";
    if (/document|fiador|garantia|renda|seguro|caucao/.test(r)) return "Explicar as garantias aceitas antes de agendar a visita.";
    if (/mobil/.test(r)) return "Informar no anúncio se o imóvel é mobiliado ou não.";
  }
  if (level === "stuck") return "Revisar anúncio e valor com o proprietário.";
  return reason ? `Analisar o motivo “${reason}” com a equipe.` : "Acompanhar as próximas visitas.";
}

export function classify(c: Counts, top: ReasonCount | null): ThermoLevel {
  if (c.done < 3) return "low_data";
  const pr = c.positive / c.done;
  if ((c.positive === 0 && c.done >= 5) || (pr < 0.2 && c.done >= 4)) return "stuck";
  if (pr < 0.35 || (top && c.negative >= 3 && top.count / c.negative >= 0.5 && pr < 0.5)) return "attention";
  return "healthy";
}

type PropRow = {
  id: string;
  code: string;
  title: string | null;
  photoUrl: string | null;
  category: string | null;
  neighborhood: string | null;
  city: string | null;
  rent: number | null;
  totalPrice: number | null;
  area: number | null;
  bedrooms: number | null;
};

export type PropertyHealth = PropRow &
  Counts & {
    visits: number;
    positiveRate: Rate;
    noShowRate: Rate;
    reasons: ReasonCount[];
    topReason: ReasonCount | null;
    topShare: number | null;
    level: ThermoLevel;
    suggestion: string;
    firstVisit: Date | null;
    lastVisit: Date | null;
    similar: { rate: Rate; properties: number; basis: string } | null;
    closed: number;
    open: number;
  };

function isSimilar(a: PropRow, b: PropRow) {
  if (a.id === b.id || !a.neighborhood || a.neighborhood !== b.neighborhood) return false;
  if (a.category && b.category && a.category !== b.category) return false;
  if (a.rent && b.rent) return Math.abs(b.rent - a.rent) / a.rent <= 0.25;
  return true;
}

/** Saúde de todos os imóveis com visitas no período (padrão: últimos 90 dias). */
export async function propertyHealth(actor: AuthzActor, opts: { days?: number | null; now?: Date; code?: string } = {}) {
  assert(hasGlobalView(actor));
  const now = opts.now ?? new Date();
  const days = opts.days === undefined ? THERMO_DAYS : opts.days;
  const since = days ? new Date(now.getTime() - days * DAY) : null;
  const visitWhere = { ...notDemo, excluded: false, scheduledStart: { ...(since ? { gte: since } : {}), lte: now } };
  const [props, reasons] = await Promise.all([
    db.property.findMany({
      where: { visits: { some: visitWhere } },
      select: {
        id: true,
        code: true,
        title: true,
        photoUrl: true,
        category: true,
        neighborhood: true,
        city: true,
        rent: true,
        totalPrice: true,
        area: true,
        bedrooms: true,
        visits: { where: visitWhere, select: { status: true, evaluation: true, negativeReasonId: true, scheduledStart: true } },
        opportunities: { select: { status: true } },
      },
    }),
    db.reason.findMany({ where: { kind: "VISIT_NEGATIVE" }, select: { id: true, label: true } }),
  ]);
  const label = new Map(reasons.map((r) => [r.id, r.label]));

  const rows: PropertyHealth[] = props.map(({ visits, opportunities, ...p }) => {
    const done = visits.filter((v) => v.status === "DONE");
    const c: Counts = {
      done: done.length,
      positive: done.filter((v) => v.evaluation === "POSITIVE").length,
      negative: done.filter((v) => v.evaluation === "NEGATIVE").length,
      undecided: done.filter((v) => v.evaluation === "UNDECIDED").length,
      noShow: visits.filter((v) => v.status === "NO_SHOW").length,
    };
    const counts = new Map<string, number>();
    for (const v of done) {
      if (v.evaluation !== "NEGATIVE") continue;
      const l = v.negativeReasonId ? (label.get(v.negativeReasonId) ?? "Outro") : "Sem motivo";
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    const rs = [...counts.entries()].map(([l, n]) => ({ label: l, count: n })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const top = rs.find((r) => r.label !== "Sem motivo") ?? null;
    const level = classify(c, top);
    const dates = visits.map((v) => v.scheduledStart.getTime());
    return {
      ...p,
      ...c,
      visits: visits.length,
      positiveRate: rate(c.positive, c.done),
      noShowRate: rate(c.noShow, c.done + c.noShow),
      reasons: rs,
      topReason: top,
      topShare: top && c.negative ? top.count / c.negative : null,
      level,
      suggestion: suggestionFor(top?.label ?? null, level),
      firstVisit: dates.length ? new Date(Math.min(...dates)) : null,
      lastVisit: dates.length ? new Date(Math.max(...dates)) : null,
      similar: null,
      closed: opportunities.filter((o) => o.status === "CLOSED_WON").length,
      open: opportunities.filter((o) => o.status === "FOLLOW_UP" || o.status === "DOCS_REVIEW").length,
    };
  });

  for (const r of rows) {
    const peers = rows.filter((o) => isSimilar(r, o) && o.done > 0);
    const done = peers.reduce((a, o) => a + o.done, 0);
    if (peers.length >= 2 && done >= 5) {
      r.similar = {
        rate: rate(
          peers.reduce((a, o) => a + o.positive, 0),
          done,
        ),
        properties: peers.length,
        basis: [`${(r.category ?? "imóvel").toLowerCase()} em ${r.neighborhood}`, r.rent ? "aluguel até 25% acima ou abaixo" : ""].filter(Boolean).join(", "),
      };
    }
  }

  const order: Record<ThermoLevel, number> = { stuck: 0, attention: 1, healthy: 2, low_data: 3 };
  const totalDone = rows.reduce((a, r) => a + r.done, 0);
  const agency = rate(
    rows.reduce((a, r) => a + r.positive, 0),
    totalDone,
  );
  const sorted = rows.sort((a, b) => order[a.level] - order[b.level] || b.negative - a.negative || b.visits - a.visits);
  return { rows: opts.code ? sorted.filter((r) => r.code === opts.code) : sorted, agency, days, since };
}
