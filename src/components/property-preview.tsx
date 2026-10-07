/* eslint-disable @next/next/no-img-element */
import { propertyUrl } from "@/server/property-preview";
import { Icon } from "./icons";
import { cx } from "./ui";

/** Miniatura do imóvel (foto do site) com fallback neutro. */
export function PropertyThumb({ photoUrl, className }: { photoUrl?: string | null; className?: string }) {
  return (
    <span className={cx("relative grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-tint", className)}>
      {photoUrl ? (
        <img src={photoUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />
      ) : (
        <Icon name="home" className="size-6 text-ink-3" />
      )}
    </span>
  );
}

/** Bloco do imóvel: foto ampla, título do anúncio e link para o site. */
export function PropertyCard({ code, photoUrl, title, template }: { code: string | null; photoUrl?: string | null; title?: string | null; template: string }) {
  if (!code) return null;
  const href = template.includes("{codigo}") ? propertyUrl(template, code) : null;
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      {photoUrl && (
        <div className="relative aspect-[16/9] bg-tint">
          <img src={photoUrl} alt={title ?? `Imóvel ${code}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />
        </div>
      )}
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[12px] font-bold tracking-[0.08em] text-ink-3 uppercase">Imóvel {code}</p>
          {title && <p className="mt-0.5 text-sm leading-snug font-medium text-ink-2">{title}</p>}
        </div>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-4 text-sm font-semibold hover:border-ink-3">
            Ver no site <span aria-hidden>↗</span>
          </a>
        )}
      </div>
    </div>
  );
}
