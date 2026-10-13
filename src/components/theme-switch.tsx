"use client";
import { useEffect, useState } from "react";
import { cx } from "./ui";

type Theme = "system" | "light" | "dark";
const OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "Automático" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];

/** Aparência: automático (segue o aparelho), claro ou escuro. Guardado neste aparelho (cookie de 1 ano). */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)vl_theme=(light|dark)/);
    setTheme((m?.[1] as Theme) ?? "system");
  }, []);
  function choose(t: Theme) {
    setTheme(t);
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = t === "system" ? `vl_theme=; Path=/; Max-Age=0; SameSite=Lax${secure}` : `vl_theme=${t}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }
  return (
    <div className="px-3 py-2">
      <p className="mb-1.5 text-sm font-medium">Aparência</p>
      <div role="radiogroup" aria-label="Aparência" className="grid grid-cols-3 gap-1 rounded-xl bg-tint p-1">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={theme === o.value}
            onClick={() => choose(o.value)}
            className={cx("min-h-9 rounded-lg text-[12px] font-semibold transition", theme === o.value ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
