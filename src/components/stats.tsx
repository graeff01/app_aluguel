import Link from "next/link";
import type { ReactNode } from "react";
import { formatRate, type Rate } from "@/lib/metrics";
import { cx } from "./ui";

/** Bloco de número: valor principal + contexto (amostra) em texto. */
export function StatTile({ label, value, detail, href, tone, compare, size = "md" }: { label: string; value: ReactNode; detail?: ReactNode; href?: string; tone?: "accent"; compare?: ReactNode; size?: "md" | "lg" }) {
  const body = (
    <>
      <p className="text-[13px] font-semibold text-ink-2">{label}</p>
      <p className={cx("num mt-2 leading-none font-bold tracking-[-0.04em]", size === "lg" ? "text-[44px]" : "text-[34px]", tone === "accent" ? "text-accent-strong" : "text-ink")}>{value}</p>
      {compare && <div className="mt-2.5">{compare}</div>}
      {detail && <p className="mt-2 text-[13px] leading-snug text-ink-3">{detail}</p>}
    </>
  );
  const cls = "relative block h-full rounded-3xl border border-line bg-surface p-5 shadow-card";
  return href ? (
    <Link href={href} className={cx(cls, "transition-shadow hover:shadow-float")}>
      {body}
      <span aria-hidden className="absolute top-5 right-5 text-ink-3/60">↗</span>
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function RateValue({ r }: { r: Rate }) {
  if (r.value === null) return <span className="text-[24px] tracking-[-0.02em] text-ink-3">Sem base</span>;
  return <>{formatRate(r)}</>;
}

export function rateDetail(r: Rate, unit: string) {
  return r.value === null ? "nenhum registro no período" : `${r.num} de ${r.den} ${unit}`;
}

/** Comparação com a equipe em pontos percentuais (texto + seta, nunca só cor). */
export function VsTeam({ mine, team, higherIsBetter = true }: { mine: Rate; team: Rate; higherIsBetter?: boolean }) {
  if (mine.value === null || team.value === null) return <span className="text-[12px] text-ink-3">Equipe: {formatRate(team)}</span>;
  const diff = Math.round((mine.value - team.value) * 1000) / 10;
  const good = diff === 0 ? null : higherIsBetter ? diff > 0 : diff < 0;
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-semibold", good === null ? "bg-tint text-ink-2" : good ? "bg-good-soft text-good" : "bg-bad-soft text-bad")}>
      <span aria-hidden>{diff > 0 ? "▲" : diff < 0 ? "▼" : "="}</span>
      {diff > 0 ? "+" : ""}
      {diff.toLocaleString("pt-BR")} p.p. vs equipe ({formatRate(team)})
    </span>
  );
}

/** Barras horizontais de série única. Valores em texto; barra em cor de destaque. */
export function BarList({ rows, total, empty = "Sem registros no período." }: { rows: { label: string; value: number; href?: string; extra?: string }[]; total?: number; empty?: string }) {
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return <p className="rounded-3xl border border-dashed border-line-strong bg-surface-2 p-5 text-sm text-ink-3">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-card">
      {rows.map((r) => {
        const pct = total ? Math.round((r.value / total) * 1000) / 10 : null;
        const content = (
          <>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[14px] font-medium">{r.label}</span>
              <span className="num shrink-0 text-[13px] text-ink-3">
                <strong className="text-[15px] text-ink">{r.value}</strong>
                {pct !== null && <> · {pct.toLocaleString("pt-BR")}%</>}
                {r.extra && <> · {r.extra}</>}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-tint" aria-hidden>
              <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 6 : 0 }} />
            </div>
          </>
        );
        return (
          <li key={r.label} title={`${r.label}: ${r.value}${pct !== null ? ` (${pct}%)` : ""}`}>
            {r.href ? (
              <Link href={r.href} className="-m-1.5 block rounded-xl p-1.5 hover:bg-tint">
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Delta({ now, before }: { now: number; before: number }) {
  if (before === 0 && now === 0) return null;
  const d = now - before;
  return (
    <span>
      <span className={cx("font-semibold", d > 0 ? "text-good" : d < 0 ? "text-bad" : "")}>
        {d > 0 ? "▲ +" : d < 0 ? "▼ " : "= "}
        {d}
      </span>{" "}
      vs período anterior ({before})
    </span>
  );
}
