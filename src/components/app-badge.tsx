"use client";
import { useEffect } from "react";

/** Número no ícone do app instalado (Android/Chrome e iPhone com app na tela inicial). Ignorado onde não houver suporte. */
export function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (count > 0) nav.setAppBadge?.(count)?.catch(() => undefined);
      else nav.clearAppBadge?.()?.catch(() => undefined);
    } catch {}
  }, [count]);
  return null;
}
