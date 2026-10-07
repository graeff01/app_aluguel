import Link from "next/link";
import { requireManager, orNotFound } from "@/lib/require";
import { propertyDetail } from "@/server/insights";
import { formatRate } from "@/lib/metrics";
import { fmt, dateOnlyKey } from "@/lib/time";
import { EVALUATION_LABEL, OPP_STATUS_LABEL, STATUS_LABEL } from "@/lib/labels";
import { Badge, PageHeader, Section, cx } from "@/components/ui";
import { BarList, RateValue, StatTile, rateDetail } from "@/components/stats";
import { PropertyCard } from "@/components/property-preview";
import { TONE_BAR, visitTone } from "@/lib/visit-tone";

export const metadata = { title: "Imóvel" };

export default async function PropertyPage({ params }: { params: Promise<{ code: string }> }) {
  const actor = await requireManager();
  const { code } = await params;
  const now = new Date();
  const { property: p, metrics: m, reasonLabel, settings } = await orNotFound(propertyDetail(actor, decodeURIComponent(code), now));
  const openOpps = p.opportunities.filter((o) => o.status === "FOLLOW_UP" || o.status === "DOCS_REVIEW");
  return (
    <>
      <Link href="/imoveis" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Imóveis
      </Link>
      <PageHeader eyebrow="Imóvel" title={p.code} subtitle={p.title ?? undefined} />
      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <PropertyCard code={p.code} photoUrl={p.photoUrl} title={p.title} template={settings.propertyUrlTemplate} />
        <div className="grid grid-cols-2 gap-3 self-start">
          <StatTile label="Visitas" value={m.totals.scheduled} detail={`${m.totals.done} realizadas · ${m.totals.noShow} não compareceu`} />
          <StatTile label="Taxa de positivas" value={<RateValue r={m.positiveRate} />} detail={rateDetail(m.positiveRate, "realizadas")} />
          <StatTile label="Em andamento" value={openOpps.length} detail="oportunidades abertas" />
          <StatTile label="Locações fechadas" value={p.opportunities.filter((o) => o.status === "CLOSED_WON").length} detail="desde a primeira visita" />
        </div>
      </div>

      <div className="grid gap-x-6 lg:grid-cols-2">
        <Section title="Por que não avançou" hint="Motivos das visitas negativas deste imóvel">
          <BarList total={m.evaluations.negative} rows={m.negativeReasons.map((r) => ({ label: reasonLabel.get(r.reasonId) ?? "Sem motivo", value: r.count }))} empty="Nenhuma visita negativa." />
        </Section>
        <Section title="Avaliações">
          <BarList
            total={m.evaluations.evaluated}
            rows={[
              { label: "Positiva", value: m.evaluations.positive },
              { label: "Ainda decidindo", value: m.evaluations.undecided },
              { label: "Negativa", value: m.evaluations.negative },
            ]}
            empty="Nenhuma visita realizada."
          />
        </Section>
      </div>

      {p.opportunities.length > 0 && (
        <Section title="Oportunidades">
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
            {p.opportunities.map((o) => (
              <li key={o.id}>
                <Link href={`/oportunidades/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface-2">
                  <span>
                    <span className="font-semibold">{o.client.name}</span>
                    <span className="text-sm text-ink-3"> · ciclo {o.cycle} · {o.responsible?.name ?? "—"}</span>
                  </span>
                  <Badge tone={o.status === "CLOSED_WON" ? "good" : o.status === "LOST" ? "bad" : "info"}>
                    {OPP_STATUS_LABEL[o.status]}
                    {o.closedAt ? ` · ${fmt.dayKey(dateOnlyKey(o.closedAt))}` : ""}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Visitas (${p.visits.length})`}>
        <ul className="space-y-2">
          {p.visits.slice(0, 50).map((v) => (
            <li key={v.id} className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              <span aria-hidden className={cx("absolute inset-y-0 left-0 w-1", TONE_BAR[visitTone(v, now)])} />
              <Link href={`/visitas/${v.id}`} className="block py-3 pr-4 pl-5 hover:bg-surface-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    {v.clientName ?? "Cliente sem nome"} <span className="font-normal text-ink-3">· {v.consultant?.name ?? "sem consultora"}</span>
                  </span>
                  <span className="text-sm text-ink-3">
                    {fmt.date(v.scheduledStart)} · {v.evaluation ? EVALUATION_LABEL[v.evaluation] : STATUS_LABEL[v.status]}
                    {v.negativeReason ? ` · ${v.negativeReason.label}` : ""}
                  </span>
                </div>
                {v.note && <p className="mt-1 line-clamp-2 text-sm text-ink-2">“{v.note}”</p>}
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
