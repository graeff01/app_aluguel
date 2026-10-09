import Link from "next/link";
import { requireManager } from "@/lib/require";
import { dayKey } from "@/lib/time";
import { buildMonthlyReport, isMonth, monthRange, pctText, shiftMonth } from "@/server/report";
import { Avatar, PageHeader, Section, Segmented, cx } from "@/components/ui";
import { StatTile } from "@/components/stats";
import { Icon } from "@/components/icons";

export const metadata = { title: "Relatórios" };

function DeltaChip({ d, unit, lower }: { d: number | null; unit: string; lower?: boolean }) {
  if (d === null) return <span className="text-[12px] text-ink-3">sem comparação</span>;
  const good = d === 0 ? null : lower ? d < 0 : d > 0;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold", good === null ? "bg-tint text-ink-2" : good ? "bg-good-soft text-good" : "bg-bad-soft text-bad")}>
      <span aria-hidden>{d > 0 ? "▲" : d < 0 ? "▼" : "="}</span>
      {d > 0 ? "+" : ""}
      {d.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
      {unit} vs mês anterior
    </span>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const actor = await requireManager();
  const { mes } = await searchParams;
  const current = dayKey(new Date()).slice(0, 7);
  // padrão: mês anterior completo
  const month = isMonth(mes) ? mes : shiftMonth(current, -1);
  const r = await buildMonthlyReport(actor, month);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(current, -i));
  const pp = (a: { value: number | null }, b: { value: number | null }) => (a.value === null || b.value === null ? null : Math.round((a.value - b.value) * 1000) / 10);
  const rel = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));
  const pdf = `/api/relatorios/mensal?mes=${month}`;

  return (
    <>
      <PageHeader
        eyebrow="Relatório mensal"
        title={`Visitas — ${r.label}`}
        subtitle={r.partial ? "Mês em andamento: números parciais até hoje." : `Comparado com ${r.prevLabel}.`}
        action={
          <div className="flex flex-wrap gap-2">
            <a href={`${pdf}&ver=1`} target="_blank" rel="noopener" className="press inline-flex min-h-12 items-center gap-2 rounded-full border border-line-strong bg-surface px-5 text-[15px] font-semibold shadow-card">
              Abrir PDF
            </a>
            <a href={pdf} download className="press inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-on-primary shadow-float">
              <span aria-hidden>↓</span> Baixar PDF
            </a>
          </div>
        }
      />

      <div className="mb-8">
        <Segmented
          label="Mês"
          items={months.slice(0, 6).map((m) => ({ href: `?mes=${m}`, label: monthRange(m).short + (m === current ? " (atual)" : ""), active: m === month }))}
        />
        <details className="mt-2 inline-block">
          <summary className="cursor-pointer text-sm font-semibold text-ink-2 underline underline-offset-4">Meses anteriores</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {months.slice(6).map((m) => (
              <Link key={m} href={`?mes=${m}`} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold">
                {monthRange(m).short}
              </Link>
            ))}
          </div>
        </details>
      </div>

      <Section title="Resumo">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile size="lg" label="Visitas realizadas" value={r.team.done} compare={<DeltaChip d={rel(r.team.done, r.teamPrev.done)} unit="%" />} detail={`${r.team.scheduled} agendadas`} />
          <StatTile size="lg" label="Taxa de positivas" value={pctText(r.team.positiveRate)} compare={<DeltaChip d={pp(r.team.positiveRate, r.teamPrev.positiveRate)} unit=" p.p." />} detail={r.team.positiveRate.den ? `${r.team.positiveRate.num} de ${r.team.positiveRate.den} realizadas` : undefined} />
          <StatTile size="lg" label="Cobertura de registro" value={pctText(r.team.coverage)} compare={<DeltaChip d={pp(r.team.coverage, r.teamPrev.coverage)} unit=" p.p." />} detail={`meta ${r.goal}%`} />
          <StatTile label="Não comparecimento" value={pctText(r.team.noShowRate)} compare={<DeltaChip d={pp(r.team.noShowRate, r.teamPrev.noShowRate)} unit=" p.p." lower />} />
          <StatTile label="Locações fechadas" value={r.team.closures} compare={<DeltaChip d={rel(r.team.closures, r.teamPrev.closures)} unit="%" />} />
          <StatTile label="Conversão da coorte" value={pctText(r.team.cohort)} detail={r.team.cohort.den ? `${r.team.cohort.num} de ${r.team.cohort.den} · ${r.team.cohort.open} abertas` : "sem oportunidades"} />
        </div>
      </Section>

      <Section title="Destaques">
        <ul className="space-y-2 rounded-3xl border border-line bg-surface p-5 shadow-card">
          {r.highlights.map((h, i) => (
            <li key={i} className="flex gap-3 text-[15px]">
              <span aria-hidden className={cx("font-bold", h.tone === "good" ? "text-good" : h.tone === "bad" ? "text-bad" : "text-ink-3")}>
                {h.tone === "good" ? "▲" : h.tone === "bad" ? "▼" : "•"}
              </span>
              {h.text}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Consultoras" hint="Prévia — o PDF traz gráficos, evolução de 6 meses, funil, motivos, imóveis e uma ficha por consultora.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {r.perConsultant.map((c) => (
            <div key={c.id} className="rounded-3xl border border-line bg-surface p-5 shadow-card">
              <div className="mb-3 flex items-center gap-3">
                <Avatar name={c.name} />
                <div>
                  <p className="font-bold">{c.name}</p>
                  <p className="text-[13px] text-ink-3">
                    {c.kpis.scheduled} agendadas · {c.kpis.done} realizadas
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                {[
                  ["Positivas", pctText(c.kpis.positiveRate)],
                  ["Cobertura", pctText(c.kpis.coverage)],
                  ["Fechadas", String(c.kpis.closures)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{k}</dt>
                    <dd className={cx("num mt-1 font-bold", v === "Sem base" ? "text-[13px] text-ink-3" : "text-[20px]")}>{v}</dd>
                  </div>
                ))}
              </dl>
              {c.topReason && <p className="mt-3 text-[13px] text-ink-3">Principal recusa: {c.topReason.label}</p>}
            </div>
          ))}
        </div>
      </Section>

      <a href={pdf} download className="press mb-6 flex items-center justify-between gap-3 rounded-3xl bg-primary px-6 py-5 text-on-primary shadow-float">
        <span>
          <span className="block text-[17px] font-bold">Relatório completo em PDF</span>
          <span className="text-sm opacity-70">{r.perConsultant.length + 5} páginas · pronto para enviar à direção</span>
        </span>
        <Icon name="arrow" className="size-5" />
      </a>
    </>
  );
}
