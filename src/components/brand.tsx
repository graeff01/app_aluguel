/* eslint-disable @next/next/no-img-element */
/** Marca da Auxiliadora Predial (arquivos em public/brand). */
export function BrandSymbol({ className = "size-8" }: { className?: string }) {
  return <img src="/brand/auxiliadora-simbolo.svg" alt="" aria-hidden className={className} />;
}

/** tone "auto": logo escuro no tema claro e branco no tema escuro. */
export function BrandLogo({ tone = "auto", className = "h-8 w-auto" }: { tone?: "auto" | "dark" | "light"; className?: string }) {
  if (tone === "auto") {
    return (
      <picture>
        <source srcSet="/brand/auxiliadora-logo-branco.svg" media="(prefers-color-scheme: dark)" />
        <img src="/brand/auxiliadora-logo.svg" alt="Auxiliadora Predial" className={className} />
      </picture>
    );
  }
  return <img src={tone === "light" ? "/brand/auxiliadora-logo-branco.svg" : "/brand/auxiliadora-logo.svg"} alt="Auxiliadora Predial" className={className} />;
}
