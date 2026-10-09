/**
 * Relatório do imóvel para o proprietário: o que as visitas mostram sobre o imóvel.
 * LGPD: só números e motivos padronizados — sem nomes, telefones, observações livres ou nomes da equipe.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notFound } from "@/lib/errors";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { propertyUrl } from "./property-preview";
import { propertyHealth, THERMO_LABEL, type PropertyHealth } from "./thermometer";
import { dayKey } from "@/lib/time";
import type { Rate } from "@/lib/metrics";

export const OWNER_PERIODS = { "90": 90, "180": 180, "365": 365, tudo: null } as const;
export type OwnerPeriod = keyof typeof OWNER_PERIODS;
export const isOwnerPeriod = (v: unknown): v is OwnerPeriod => typeof v === "string" && v in OWNER_PERIODS;

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export type OwnerReport = {
  property: PropertyHealth & { url: string | null };
  periodLabel: string;
  generatedAt: Date;
  agency: Rate;
  months: { label: string; visits: number; positive: number }[];
  levelLabel: string;
  findings: string[];
  photo: Buffer | null;
};

/** Só baixa a foto do mesmo domínio do site de anúncios configurado (evita buscar endereços arbitrários). */
async function fetchPhoto(url: string | null, template: string): Promise<Buffer | null> {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const site = new URL(template.replace(/\{codigo\}/g, "x")).hostname.replace(/^www\./, "");
    const host = new URL(url).hostname;
    if (host !== site && !host.endsWith(`.${site}`)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/image\/(jpe?g|png)/i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length < 4_000_000 ? buf : null;
  } catch {
    return null;
  }
}

const pct = (r: Rate) => (r.value === null ? null : Math.round(r.value * 100));

export async function buildOwnerReport(actor: AuthzActor, code: string, period: OwnerPeriod, now = new Date(), opts: { photo?: boolean } = {}): Promise<OwnerReport> {
  assert(hasGlobalView(actor));
  const days = OWNER_PERIODS[period];
  const { rows, agency } = await propertyHealth(actor, { days, now });
  const p = rows.find((r) => r.code === code);
  if (!p) {
    if (!(await db.property.findUnique({ where: { code }, select: { id: true } }))) throw notFound();
  }
  const settings = await getSettings();
  const base: PropertyHealth =
    p ??
    ({
      ...(await db.property.findUniqueOrThrow({ where: { code }, select: { id: true, code: true, title: true, photoUrl: true, category: true, neighborhood: true, city: true, rent: true, totalPrice: true, area: true, bedrooms: true } })),
      done: 0, positive: 0, negative: 0, undecided: 0, noShow: 0, visits: 0,
      positiveRate: { num: 0, den: 0, value: null }, noShowRate: { num: 0, den: 0, value: null },
      reasons: [], topReason: null, topShare: null, level: "low_data", suggestion: "Ainda não há visitas suficientes no período.",
      firstVisit: null, lastVisit: null, similar: null, closed: 0, open: 0,
    } satisfies PropertyHealth);

  // visitas por mês no período (no máximo 12 colunas)
  const visits = await db.visit.findMany({
    where: { propertyCode: code, excluded: false, status: { in: ["DONE", "NO_SHOW"] }, scheduledStart: { ...(days ? { gte: new Date(now.getTime() - days * 86400_000) } : {}), lte: now } },
    select: { scheduledStart: true, evaluation: true, status: true },
    orderBy: { scheduledStart: "asc" },
  });
  const byMonth = new Map<string, { visits: number; positive: number }>();
  const startKey = (days ? dayKey(new Date(now.getTime() - days * 86400_000)) : visits[0] ? dayKey(visits[0].scheduledStart) : dayKey(now)).slice(0, 7);
  for (let k = startKey; k <= dayKey(now).slice(0, 7); ) {
    byMonth.set(k, { visits: 0, positive: 0 });
    const [y, m] = k.split("-").map(Number);
    k = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  for (const v of visits) {
    const k = dayKey(v.scheduledStart).slice(0, 7);
    const row = byMonth.get(k) ?? { visits: 0, positive: 0 };
    if (v.status === "DONE") row.visits++;
    if (v.evaluation === "POSITIVE") row.positive++;
    byMonth.set(k, row);
  }
  const months = [...byMonth.entries()].slice(-12).map(([k, v]) => ({ label: `${MONTHS[Number(k.slice(5)) - 1]}/${k.slice(2, 4)}`, ...v }));

  // achados em linguagem simples, sempre com o número
  const findings: string[] = [];
  const pr = pct(base.positiveRate);
  if (base.done) findings.push(`${base.done} ${base.done === 1 ? "visita realizada" : "visitas realizadas"}; ${base.positive} ${base.positive === 1 ? "visitante gostou" : "visitantes gostaram"} (${pr}%).`);
  if (base.topReason && base.negative) findings.push(`Motivo mais citado por quem não gostou: “${base.topReason.label}” (${base.topReason.count} de ${base.negative}, ${Math.round((base.topShare ?? 0) * 100)}%).`);
  if (base.similar && pr !== null) {
    const sp = pct(base.similar.rate)!;
    const diff = pr - sp;
    findings.push(
      Math.abs(diff) < 5
        ? `Interesse em linha com imóveis parecidos (${sp}%).`
        : diff > 0
          ? `Interesse ${diff} pontos acima de imóveis parecidos (${sp}%).`
          : `Interesse ${-diff} pontos abaixo de imóveis parecidos (${sp}%).`,
    );
  } else if (pct(agency) !== null && pr !== null) {
    findings.push(`Média de interesse da agência no período: ${pct(agency)}%.`);
  }
  if (base.noShow) findings.push(`${base.noShow} ${base.noShow === 1 ? "visitante não compareceu" : "visitantes não compareceram"} ao horário marcado.`);

  const out: OwnerReport = {
    property: { ...base, url: settings.propertyUrlTemplate.includes("{codigo}") ? propertyUrl(settings.propertyUrlTemplate, code).replace(/\?.*$/, "") : null },
    periodLabel: days ? `Últimos ${days} dias` : "Desde a primeira visita",
    generatedAt: now,
    agency,
    months,
    levelLabel: THERMO_LABEL[base.level],
    findings,
    photo: opts.photo === false ? null : await fetchPhoto(base.photoUrl, settings.propertyUrlTemplate),
  };
  await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "report.owner_pdf", entityType: "Property", entityId: base.id, changes: { codigo: code, periodo: period } }));
  return out;
}
