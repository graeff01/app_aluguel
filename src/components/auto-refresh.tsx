"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Recarrega os dados da tela periodicamente enquanto ela estiver visível (painéis "ao vivo"). */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        router.refresh();
        setAt(Date.now());
      }
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3" suppressHydrationWarning>
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-good" />
      </span>
      Atualiza sozinho · {new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
    </span>
  );
}
