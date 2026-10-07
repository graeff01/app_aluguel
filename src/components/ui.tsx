import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const btnBase =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold tracking-[-0.01em] transition-[background,box-shadow,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
export const btnVariant = {
  primary: "bg-primary text-white shadow-[0_1px_0_rgb(255_255_255/0.08)_inset,0_6px_16px_-6px_rgb(29_32_35/0.45)] hover:bg-[#33373b]",
  accent: "bg-accent text-white shadow-[0_6px_16px_-6px_color-mix(in_srgb,var(--accent)_60%,transparent)] hover:brightness-105",
  secondary: "border border-line-strong bg-surface text-ink hover:border-ink-3 hover:bg-surface-2",
  ghost: "text-ink hover:bg-black/[0.04]",
  danger: "border border-bad/30 bg-surface text-bad hover:bg-bad-soft",
};
export type BtnVariant = keyof typeof btnVariant;

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant }) {
  return <button className={cx(btnBase, btnVariant[variant], className)} {...p} />;
}

export function LinkButton({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link className={cx(btnBase, btnVariant[variant], className)} {...p} />;
}

export function PageHeader({ title, subtitle, action, eyebrow }: { title: string; subtitle?: ReactNode; action?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase">{eyebrow}</p>}
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em] text-ink md:text-[32px]">{title}</h1>
        {subtitle && <div className="mt-1.5 text-[15px] text-ink-2">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Section({ title, children, action, id, hint }: { title: string; children: ReactNode; action?: ReactNode; id?: string; hint?: ReactNode }) {
  return (
    <section className="mb-10" id={id} aria-labelledby={id ? `${id}-t` : undefined}>
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={id ? `${id}-t` : undefined} className="text-[17px] font-bold tracking-[-0.02em]">
            {title}
          </h2>
          {hint && <p className="mt-0.5 text-sm text-ink-3">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-3xl border border-line bg-surface p-5 shadow-card", className)}>{children}</div>;
}

export function Empty({ title, children, icon = "◌" }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-line-strong bg-surface-2 px-6 py-12 text-center">
      <div aria-hidden className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-surface text-lg text-ink-3 shadow-card">
        {icon}
      </div>
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-sm text-sm text-ink-2">{children}</div>}
    </div>
  );
}

const tones = {
  neutral: "bg-black/[0.05] text-ink-2",
  info: "bg-[#eef1f4] text-[#3d4b5a]",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  accent: "bg-accent-soft text-accent-strong",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] leading-none font-semibold whitespace-nowrap", tones[tone])}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const bar = { neutral: "bg-ink-3", info: "bg-[#6b7d8f]", good: "bg-good", warn: "bg-accent", bad: "bg-bad", accent: "bg-accent" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className="relative mb-5 overflow-hidden rounded-2xl border border-line bg-surface py-3.5 pr-4 pl-5 shadow-card">
      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-1", bar)} />
      {title && <p className="font-semibold text-ink">{title}</p>}
      {children && <div className="mt-0.5 text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-[13px] text-ink-3">{hint}</p>}
      {error && (
        <p className="mt-1.5 text-[13px] font-semibold text-bad" id={`${htmlFor}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "block w-full min-h-12 rounded-2xl border border-line-strong bg-surface px-4 py-2.5 text-[15px] text-ink placeholder:text-ink-3 transition-[border,box-shadow] focus:border-ink focus:shadow-[0_0_0_4px_rgb(29_32_35/0.06)] focus:outline-none aria-[invalid=true]:border-bad";

export function Input(p: ComponentProps<"input">) {
  return <input {...p} className={cx(inputClass, p.className)} />;
}
export function Textarea(p: ComponentProps<"textarea">) {
  return <textarea {...p} className={cx(inputClass, "min-h-28 py-3", p.className)} />;
}
export function Select(p: ComponentProps<"select">) {
  return <select {...p} className={cx(inputClass, "appearance-none bg-[length:12px] bg-[right_1rem_center] bg-no-repeat pr-10", p.className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%237c828a' stroke-width='1.6'/%3E%3C/svg%3E\")", ...p.style }} />;
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-sm text-ink-3">{k}</dt>
          <dd className="min-w-0 text-right text-[15px] font-medium break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, size = "md", tone = "dark" }: { name: string; size?: "sm" | "md" | "lg"; tone?: "dark" | "light" | "accent" }) {
  const initials = name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const s = { sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-14 text-lg" }[size];
  const t = { dark: "bg-primary text-white", light: "bg-black/[0.06] text-ink", accent: "bg-accent text-white" }[tone];
  return (
    <span aria-hidden className={cx("inline-grid shrink-0 place-items-center rounded-full font-bold tracking-tight", s, t)}>
      {initials || "?"}
    </span>
  );
}

/** Controle segmentado em links (filtros). */
export function Segmented({ items, label }: { items: { href: string; label: ReactNode; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="inline-flex gap-1 rounded-full border border-line bg-surface p-1 shadow-card">
        {items.map((it, i) => (
          <li key={i}>
            <Link
              href={it.href}
              aria-current={it.active ? "true" : undefined}
              className={cx(
                "inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors",
                it.active ? "bg-primary text-white" : "text-ink-2 hover:bg-black/[0.04] hover:text-ink",
              )}
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
