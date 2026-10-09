import { cx } from "./ui";
import { THERMO_LABEL, type ThermoLevel } from "@/server/thermometer";

const CLS: Record<ThermoLevel, string> = {
  stuck: "bg-bad-soft text-bad",
  attention: "bg-accent-soft text-accent-strong",
  healthy: "bg-good-soft text-good",
  low_data: "bg-tint text-ink-3",
};

export function ThermoChip({ level, className }: { level: ThermoLevel; className?: string }) {
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-bold", CLS[level], className)}>{THERMO_LABEL[level]}</span>;
}

export const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
