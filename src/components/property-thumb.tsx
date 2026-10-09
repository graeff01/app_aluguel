/* eslint-disable @next/next/no-img-element */
import { cx } from "./ui";
import { Icon } from "./icons";

/** Miniatura do imóvel com fallback neutro (sem dependências de servidor: pode ser usada em componentes do navegador). */
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
