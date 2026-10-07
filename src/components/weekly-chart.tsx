import { formatRate, type Rate } from "@/lib/metrics";
import { fmt } from "@/lib/time";
import { cx } from "./ui";

type Week = { from: string; to: string; scheduled: number; done: number; positive: number; positiveRate: Rate; coverage: Rate; awaiting: number; future: boolean };

const short = (k: string) => fmt.dayKey(k).slice(0, 5);

/**
 * Evolução semanal: colunas = visitas agendadas (traço) e realizadas (sólido, cor de destaque);
 * taxas abaixo em texto (positivas e cobertura), com "—" quando não há base.
 */
export function WeeklyChart({ weeks }: { weeks: Week[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.scheduled));
  return (
    <div className="rounded-3xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm border border-line-strong bg-black/[0.04]" /> Agendadas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-accent" /> Realizadas
        </span>
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[560px] border-separate border-spacing-x-1.5 text-center">
          <caption className="sr-only">Visitas, positivas e cobertura por semana</caption>
          <thead>
            <tr>
              <th scope="row" className="w-24 text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                <span className="sr-only">Semana</span>
              </th>
              {weeks.map((w) => (
                <th key={w.from} scope="col" className="h-32 align-bottom">
                  <div className="relative mx-auto flex h-28 w-9 items-end justify-center" title={`${short(w.from)}–${short(w.to)}: ${w.scheduled} agendadas, ${w.done} realizadas`}>
                    <div aria-hidden className="absolute bottom-0 w-full rounded-t-md border border-b-0 border-line-strong bg-black/[0.03]" style={{ height: `${(w.scheduled / max) * 100}%` }} />
                    <div aria-hidden className="relative w-[calc(100%-8px)] rounded-t-[5px] bg-accent" style={{ height: `${(w.done / max) * 100}%`, minHeight: w.done ? 3 : 0 }} />
                  </div>
                  <span className={cx("mt-2 block text-[11px] font-semibold whitespace-nowrap", w.future ? "text-ink-3/50" : "text-ink-3")}>{short(w.from)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num text-[13px]">
            {[
              { label: "Agendadas", get: (w: Week) => String(w.scheduled) },
              { label: "Realizadas", get: (w: Week) => String(w.done) },
              { label: "Positivas", get: (w: Week) => (w.positiveRate.value === null ? "—" : formatRate(w.positiveRate)) },
              { label: "Cobertura", get: (w: Week) => (w.coverage.value === null ? "—" : formatRate(w.coverage)) },
            ].map((row, i) => (
              <tr key={row.label}>
                <th scope="row" className={cx("py-1.5 text-left text-[12px] font-semibold text-ink-2", i === 0 && "pt-3")}>
                  {row.label}
                </th>
                {weeks.map((w) => (
                  <td key={w.from} className={cx("py-1.5 font-semibold", i === 0 && "pt-3", w.future ? "text-ink-3/50" : i >= 2 ? "text-ink" : "text-ink-2")}>
                    {row.get(w)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-ink-3">Semanas de segunda a domingo. “—” = sem base para a taxa naquela semana.</p>
    </div>
  );
}
