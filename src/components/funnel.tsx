type Step = { key: string; label: string; hint: string; count: number };

/** Funil de oportunidades (coorte). Largura proporcional ao início; conversão entre etapas em texto. */
export function Funnel({ steps, daysToDocs, daysToClose, open }: { steps: Step[]; daysToDocs: number | null; daysToClose: number | null; open: number }) {
  const base = steps[0]?.count ?? 0;
  if (!base) return <p className="rounded-3xl border border-dashed border-line-strong bg-surface-2 p-5 text-sm text-ink-3">Nenhuma oportunidade iniciada no período.</p>;
  return (
    <div className="rounded-3xl border border-line bg-surface p-5 shadow-card">
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const prev = i ? steps[i - 1].count : null;
          const step = prev ? Math.round((s.count / prev) * 100) : null;
          return (
            <li key={s.key}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[14px] font-semibold">
                  {s.label} <span className="font-normal text-ink-3">· {s.hint}</span>
                </span>
                <span className="num text-[13px] text-ink-3">
                  <strong className="text-[17px] text-ink">{s.count}</strong>
                  {step !== null && <> · {step}% da etapa anterior</>}
                </span>
              </div>
              <div className="h-3 rounded-full bg-tint" aria-hidden>
                <div className="h-3 rounded-full bg-accent transition-[width] duration-700" style={{ width: `${(s.count / base) * 100}%`, minWidth: s.count ? 8 : 0, opacity: 1 - i * 0.14 }} />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-3">
        <span>
          Tempo médio até documentação: <strong className="text-ink">{daysToDocs === null ? "—" : `${daysToDocs} dias`}</strong>
        </span>
        <span>
          Até fechar: <strong className="text-ink">{daysToClose === null ? "—" : `${daysToClose} dias`}</strong>
        </span>
        <span>
          Ainda abertas: <strong className="text-ink">{open}</strong>
        </span>
      </p>
    </div>
  );
}
