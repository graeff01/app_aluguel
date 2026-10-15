"use client";
import { useState } from "react";

/** Copia o resumo da locação para montar a postagem. */
export function CopySummary({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          })
          .catch(() => undefined)
      }
      className="press min-h-10 rounded-full border border-line-strong px-3.5 text-[13px] font-semibold"
    >
      {done ? "Copiado ✓" : "Copiar resumo"}
    </button>
  );
}
