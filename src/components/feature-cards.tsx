import Link from "next/link";
import { Icon } from "./icons";
import { cx } from "./ui";

/** Ícone animado da rota: o trajeto se desenha e um ponto percorre o caminho. */
function RouteGlyph() {
  return (
    <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-primary text-on-primary shadow-[0_8px_18px_-10px_rgb(29_32_35/0.7)] dark:shadow-none">
      <svg viewBox="0 0 40 40" className="size-9" fill="none" aria-hidden>
        <circle cx="9" cy="31" r="3.2" fill="currentColor" opacity="0.9" />
        <path className="fc-route-path" d="M9 31 C 9 20, 31 24, 31 12" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="4 4.5" />
        <path d="M31 4.5c-3 0-5.4 2.3-5.4 5.2 0 3.9 5.4 8.8 5.4 8.8s5.4-4.9 5.4-8.8c0-2.9-2.4-5.2-5.4-5.2Z" fill="currentColor" className="fc-route-pin" />
        <circle cx="31" cy="9.8" r="1.9" fill="var(--primary)" />
        <circle r="2.1" fill="#fff" className="fc-route-dot" />
      </svg>
    </span>
  );
}

/** Ícone animado da pré-análise: prancheta que se preenche e ganha o "ok". */
function PreGlyph() {
  return (
    <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-[#2f6fde] text-white shadow-[0_8px_18px_-10px_#2f6fde]">
      <svg viewBox="0 0 40 40" className="size-8" fill="none" aria-hidden>
        <rect x="9" y="7" width="22" height="28" rx="4" stroke="currentColor" strokeWidth="2.4" />
        <rect x="15" y="4" width="10" height="6" rx="2" fill="currentColor" />
        <path className="fc-pre-line fc-pre-l1" d="M14 17h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path className="fc-pre-line fc-pre-l2" d="M14 23h8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path className="fc-pre-check" d="M21.5 29.5l2.6 2.6 5.2-5.6" stroke="#9cf0b0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function RouteCard({ stops, next, delay = 0 }: { stops: number; next: string | null; delay?: number }) {
  return (
    <Link
      href="/rota"
      className="fc-card press animate-rise mb-3 flex items-center gap-4 rounded-[24px] border border-line bg-surface px-4 py-4 shadow-card transition-shadow hover:shadow-float"
      style={{ animationDelay: `${delay}ms` }}
    >
      <RouteGlyph />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold tracking-[-0.01em]">Rota de hoje</span>
        <span className="block text-[13px] text-ink-3">
          {stops ? `${stops} ${stops === 1 ? "parada" : "paradas"}${next ? ` · próxima às ${next}` : ""}` : "Sem visitas hoje · veja a de amanhã"} · mapa, Maps ou Waze
        </span>
      </span>
      <Icon name="arrow" className="fc-arrow size-5 shrink-0 text-ink-3" />
    </Link>
  );
}

export function PreAnalysisCard({ open, delay = 0 }: { open: number; delay?: number }) {
  return (
    <Link
      href="/pre-analises"
      className={cx(
        "fc-card press animate-rise mb-4 flex items-center gap-4 rounded-[24px] border px-4 py-4 shadow-card transition-shadow hover:shadow-float",
        "border-[#2f6fde]/25 bg-gradient-to-br from-[#eef4ff] to-[#e2ecfd] dark:from-[#1a2436] dark:to-[#1f2c44]",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <PreGlyph />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold tracking-[-0.01em] text-[#1f4fa3] dark:text-[#bcd3ff]">Pré-análises</span>
        <span className="block text-[13px] text-[#2357b3]/80 dark:text-[#93b8ff]/80">
          {open ? (open === 1 ? "1 esperando sua resposta" : `${open} esperando sua resposta`) : "Nada para responder agora"}
        </span>
      </span>
      {open > 0 ? (
        <span className="relative grid size-8 shrink-0 place-items-center">
          <span aria-hidden className="fc-pulse absolute inset-0 rounded-full bg-[#2f6fde]/35" />
          <span className="num relative grid size-8 place-items-center rounded-full bg-[#2f6fde] text-[14px] font-bold text-white">{open > 99 ? "99+" : open}</span>
        </span>
      ) : (
        <Icon name="arrow" className="fc-arrow size-5 shrink-0 text-[#2357b3]/70 dark:text-[#93b8ff]/70" />
      )}
    </Link>
  );
}
