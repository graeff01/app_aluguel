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
import { propertyHealth, THERMO_DAYS } from "@/server/thermometer";
import { ThermoChip, pct } from "@/components/thermo";
import { AddressEditor } from "@/components/address-editor";
import { Icon } from "@/components/icons";

export const metadata = { title: "Imóvel" };

export default async function PropertyPage({ params }: { params: Promise<{ code: string }> }) {
  const actor = await requireManager();
  const { code } = await params;
  const now = new Date();
  const { property: p, metrics: m, reasonLabel, settings } = await orNotFound(propertyDetail(actor, decodeURIComponent(code), now));
  const openOpps = p.opportunities.filter((o) => o.status === "FOLLOW_UP" || o.status === "DOCS_REVIEW");
  const { rows: hr, agency } = await propertyHealth(actor, { now });
  const h = hr.find((x) => x.code === p.code) ?? null;
  const brl = (n: number | null) => (n ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : null);
  const facts = [p.category, p.neighborhood, p.area ? `${p.area} m²` : null, p.bedrooms ? `${p.bedrooms} quartos` : null, p.rent ? `aluguel ${brl(p.rent)}` : null, p.totalPrice ? `total ${brl(p.totalPrice)}` : null].filter(Boolean);
  const pdf = (periodo: string, ver?: boolean) => `/api/imoveis/${encodeURIComponent(p.code)}/relatorio?periodo=${periodo}${ver ? "&ver=1" : ""}`;
  return (
    <>
      <Link href="/imoveis" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Imóveis
      </Link>
      <PageHeader eyebrow="Imóvel" title={p.code} subtitle={p.title ?? undefined} />
      {facts.length > 0 && <p className="-mt-3 mb-6 text-sm text-ink-2">{facts.join(" · ")}</p>}

      <section aria-labelledby="t-termo" className="mb-8 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="t-termo" className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em]">
            <Icon name="thermo" className="size-5 text-accent-strong" /> Termômetro · últimos {THERMO_DAYS} dias
          </h2>
          {h && <ThermoChip level={h.level} />}
        </div>
        {h ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: "Este imóvel", value: pct(h.positiveRate.value), sub: `${h.positive} de ${h.done} gostaram` },
                { label: "Parecidos", value: h.similar ? pct(h.similar.rate.value) : "—", sub: h.similar ? `${h.similar.properties} imóveis` : "sem base suficiente" },
                { label: "Agência", value: pct(agency.value), sub: "média de interesse" },
              ].map((t) => (
                <div key={t.label} className="rounded-2xl bg-tint px-3 py-3">
                  <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{t.label}</p>
                  <p className="num text-[22px] leading-tight font-bold">{t.value}</p>
                  <p className="text-[12px] text-ink-3">{t.sub}</p>
                </div>
              ))}
            </div>
            {h.topReason && (
              <p className="mt-4 text-sm text-ink-2">
                Motivo mais citado: <strong className="text-ink">{h.topReason.label}</strong> ({h.topReason.count} de {h.negative} negativas)
              </p>
            )}
            <p className="mt-2 text-[15px] font-semibold text-accent-strong">{h.suggestion}</p>
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-3">Sem visitas nos últimos {THERMO_DAYS} dias.</p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <a href={pdf("90")} className="press inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-on-primary">
            Relatório para o proprietário (PDF)
          </a>
          <a href={pdf("90", true)} target="_blank" rel="noopener" className="press inline-flex min-h-11 items-center rounded-full bg-tint px-4 text-sm font-semibold">
            Abrir
          </a>
          <span className="text-[13px] text-ink-3">
            Outros períodos:{" "}
            {[
              ["180", "6 meses"],
              ["365", "12 meses"],
              ["tudo", "tudo"],
            ].map(([k, l], i) => (
              <span key={k}>
                {i > 0 && " · "}
                <a href={pdf(k)} className="font-semibold text-ink underline underline-offset-4">
                  {l}
                </a>
              </span>
            ))}
          </span>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">Só números e motivos padronizados — sem nomes, telefones, observações ou nomes da equipe.</p>
      </section>
      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div>
          <PropertyCard code={p.code} photoUrl={p.photoUrl} title={p.title} template={settings.propertyUrlTemplate} />
          <div className="mt-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm shadow-card">
            <p className="flex items-start gap-2 text-ink-2">
              <Icon name="pin" className="mt-0.5 size-4 shrink-0 text-ink-3" />
              {p.address ? (
                <span>
                  {p.address} <span className="text-[12px] text-ink-3">({p.addressSource === "AGENDA" ? "da agenda" : "informado no app"})</span>
                </span>
              ) : (
                <span className="text-ink-3">Sem endereço — a rota do dia usa só o bairro.</span>
              )}
            </p>
            <AddressEditor code={p.code} address={p.address} compact />
          </div>
        </div>
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
