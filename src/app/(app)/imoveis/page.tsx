import Link from "next/link";
import { requireManager } from "@/lib/require";
import { listProperties } from "@/server/insights";
import { formatRate } from "@/lib/metrics";
import { fmt } from "@/lib/time";
import { Empty, PageHeader, cx } from "@/components/ui";
import { PropertyThumb } from "@/components/property-preview";
import { propertyHealth, THERMO_DAYS } from "@/server/thermometer";
import { ThermoChip, pct } from "@/components/thermo";
import { Icon } from "@/components/icons";

export const metadata = { title: "Imóveis" };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireManager();
  const { q } = await searchParams;
  const [rows, health] = await Promise.all([listProperties(actor, q), propertyHealth(actor)]);
  const level = new Map(health.rows.map((h) => [h.code, h.level]));
  const alerts = health.rows.filter((h) => h.level === "stuck" || h.level === "attention");
  return (
    <>
      <PageHeader title="Imóveis" subtitle="Desempenho de cada imóvel visitado — volume ao lado das taxas." />

      {!q && (
        <section aria-labelledby="t-termo" className="mb-9">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="t-termo" className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em]">
              <Icon name="thermo" className="size-5 text-accent-strong" /> Termômetro
            </h2>
            <p className="text-[13px] text-ink-3">
              Últimos {THERMO_DAYS} dias · média da agência {pct(health.agency.value)} de interesse
            </p>
          </div>
          {alerts.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-line-strong px-5 py-5 text-center text-sm text-ink-3">Nenhum imóvel encalhando agora. Imóveis com 3 visitas ou mais aparecem aqui quando o interesse cai.</p>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {alerts.slice(0, 8).map((h, i) => (
                <li key={h.code} className="animate-rise" style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
                  <Link href={`/imoveis/${encodeURIComponent(h.code)}`} className="press flex h-full gap-4 rounded-3xl border border-line bg-surface p-4 shadow-card hover:shadow-float">
                    <PropertyThumb photoUrl={h.photoUrl} className="size-16" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num font-bold">{h.code}</span>
                        <ThermoChip level={h.level} />
                        {h.neighborhood && <span className="truncate text-[12px] text-ink-3">{h.neighborhood}</span>}
                      </div>
                      <p className="mt-1 text-[13px] text-ink-2">
                        <strong className="num text-ink">{h.done}</strong> visitas · <strong className="num text-ink">{h.positive}</strong> gostaram ({pct(h.positiveRate.value)})
                        {h.similar ? <span className="text-ink-3"> · parecidos {pct(h.similar.rate.value)}</span> : null}
                      </p>
                      {h.topReason && (
                        <p className="mt-0.5 text-[13px] text-ink-2">
                          Motivo: <strong className="text-ink">{h.topReason.label}</strong> ({h.topReason.count} de {h.negative})
                        </p>
                      )}
                      <p className="mt-1.5 text-[13px] font-semibold text-accent-strong">{h.suggestion}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <form role="search" className="mb-6 max-w-md">
        <label htmlFor="q" className="sr-only">
          Buscar imóvel
        </label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Código ou bairro" className="block min-h-12 w-full rounded-full border border-line-strong bg-surface px-5 text-[15px] shadow-card focus:border-ink focus:outline-none" />
      </form>
      {rows.length === 0 ? (
        <Empty title="Nenhum imóvel encontrado" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r, i) => (
            <li key={r.code} className="animate-rise" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <Link href={`/imoveis/${encodeURIComponent(r.code)}`} className="press flex h-full gap-4 rounded-3xl border border-line bg-surface p-4 shadow-card hover:shadow-float">
                <PropertyThumb photoUrl={r.photoUrl} className="size-20" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="num font-bold">{r.code}</span>
                    {level.get(r.code) && level.get(r.code) !== "low_data" && level.get(r.code) !== "healthy" && <ThermoChip level={level.get(r.code)!} />}
                  </p>
                  <p className="line-clamp-2 text-[13px] text-ink-3">{r.title ?? "Sem dados do anúncio"}</p>
                  <p className="mt-2 flex flex-wrap gap-x-3 text-[13px] text-ink-2">
                    <span>
                      <strong className="num text-ink">{r.visits}</strong> visitas
                    </span>
                    <span className={cx(r.positiveRate.value !== null && r.positiveRate.value < 0.25 && r.done >= 4 && "font-semibold text-bad")}>
                      {formatRate(r.positiveRate)} positivas{r.done ? ` (${r.positive}/${r.done})` : ""}
                    </span>
                    {r.closed > 0 && <span className="font-semibold text-good">{r.closed} fechada{r.closed > 1 ? "s" : ""}</span>}
                  </p>
                  {r.lastVisit && <p className="mt-1 text-[12px] text-ink-3">Última visita {fmt.date(r.lastVisit)}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
