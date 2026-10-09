/* eslint-disable @next/next/no-img-element */
import { propertyUrl } from "@/server/property-preview";
import { Icon } from "./icons";
import { cx } from "./ui";

export { PropertyThumb } from "./property-thumb";

/** Bloco do imóvel: foto ampla, título do anúncio e link para o site. */
export function PropertyCard({ code, photoUrl, title, template, statsHref }: { code: string | null; photoUrl?: string | null; title?: string | null; template: string; statsHref?: string }) {
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
          {statsHref && (
            <a href={statsHref} className="mt-1 inline-block text-[13px] font-semibold text-ink underline underline-offset-4">
              Desempenho deste imóvel
            </a>
          )}
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
