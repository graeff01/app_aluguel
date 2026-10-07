import Link from "next/link";
import { requireManager } from "@/lib/require";
import { listProperties } from "@/server/insights";
import { formatRate } from "@/lib/metrics";
import { fmt } from "@/lib/time";
import { Empty, PageHeader, cx } from "@/components/ui";
import { PropertyThumb } from "@/components/property-preview";

export const metadata = { title: "Imóveis" };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireManager();
  const { q } = await searchParams;
  const rows = await listProperties(actor, q);
  return (
    <>
      <PageHeader title="Imóveis" subtitle="Desempenho de cada imóvel visitado — volume ao lado das taxas." />
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
                  <p className="num font-bold">{r.code}</p>
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
