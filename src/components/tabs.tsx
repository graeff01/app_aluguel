"use client";
import { useId, useState, type ReactNode } from "react";
import { cx } from "./ui";

/** Abas acessíveis (setas do teclado navegam entre elas). Conteúdo renderizado no servidor. */
export function Tabs({ tabs }: { tabs: { id: string; label: string; count?: number; content: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const base = useId();
  return (
    <div>
      <div role="tablist" aria-label="Seções da visita" className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
        {tabs.map((t, i) => {
          const sel = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={sel}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={sel ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
                setActive(next.id);
                document.getElementById(`${base}-tab-${next.id}`)?.focus();
              }}
              className={cx(
                "relative min-h-12 shrink-0 px-4 text-[15px] font-semibold whitespace-nowrap transition-colors",
                sel ? "text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {t.label}
              {t.count ? <span className="num ml-1.5 rounded-full bg-tint px-1.5 text-[12px]">{t.count}</span> : null}
              {sel && <span aria-hidden className="absolute inset-x-3 -bottom-px h-[3px] rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} hidden={t.id !== active} className="animate-rise">
          {t.content}
        </div>
      ))}
    </div>
  );
}
