/**
 * Cor de status do card (barra lateral). Sempre acompanhada de texto — nunca a cor sozinha.
 */
export type VisitToneKey = "overdue" | "awaiting" | "live" | "upcoming" | "positive" | "negative" | "undecided" | "closed" | "excluded";

export const TONE_BAR: Record<VisitToneKey, string> = {
  overdue: "bg-[#c2452d]",
  awaiting: "bg-accent",
  live: "bg-[#2f6fde] dark:bg-[#5b8ff0]",
  upcoming: "bg-[#9db6d6] dark:bg-[#4e6582]",
  positive: "bg-good",
  negative: "bg-bad",
  undecided: "bg-[#9aa0a7]",
  closed: "bg-line-strong",
  excluded: "bg-line",
};

export const TONE_TEXT: Record<VisitToneKey, string> = {
  overdue: "text-[#a8402d] dark:text-[#f0907b]",
  awaiting: "text-accent-strong",
  live: "text-[#2357b3] dark:text-[#93b8ff]",
  upcoming: "text-ink-3",
  positive: "text-good",
  negative: "text-bad",
  undecided: "text-ink-3",
  closed: "text-ink-3",
  excluded: "text-ink-3",
};

type V = { status: string; evaluation: string | null; scheduledStart: Date; scheduledEnd: Date; excluded?: boolean };

export function visitTone(v: V, now = new Date()): VisitToneKey {
  if (v.excluded) return "excluded";
  if (v.status === "SCHEDULED") {
    if (v.scheduledEnd <= now) return now.getTime() - v.scheduledEnd.getTime() > 24 * 3600_000 ? "overdue" : "awaiting";
    return v.scheduledStart <= now ? "live" : "upcoming";
  }
  if (v.status === "DONE") return v.evaluation === "POSITIVE" ? "positive" : v.evaluation === "NEGATIVE" ? "negative" : "undecided";
  return "closed";
}

/** "em 40 min", "há 2 h", "há 3 dias" — orientação rápida, sempre ao lado do horário exato. */
export function relativeTime(target: Date, now = new Date()): string {
  const diff = target.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  const fmt = (n: number, unit: string) => (diff >= 0 ? `em ${n} ${unit}` : `há ${n} ${unit}`);
  if (min < 1) return "agora";
  if (min < 60) return fmt(min, "min");
  const h = Math.round(min / 60);
  if (h < 24) return fmt(h, "h");
  const d = Math.round(h / 24);
  return fmt(d, d === 1 ? "dia" : "dias");
}
