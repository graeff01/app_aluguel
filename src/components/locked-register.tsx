"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cx } from "./ui";

/**
 * Botão de registro antes do horário: visível, porém travado (cadeado + horário de liberação).
 * Libera sozinho 15 min antes do início, sem recarregar a tela.
 */
export function LockedRegisterButton({ href, unlockAt, unlockLabel, className }: { href: string; unlockAt: string; unlockLabel: string; className?: string }) {
  const router = useRouter();
  const target = new Date(unlockAt).getTime();
  const [open, setOpen] = useState(() => Date.now() >= target);
  useEffect(() => {
    if (open) return;
    const tick = () => {
      if (Date.now() >= target) {
        setOpen(true);
        router.refresh(); // atualiza o card (passa a "em andamento")
      }
    };
    const t = setInterval(tick, 20_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [open, target, router]);

  if (open) {
    return (
      <Link href={href} className={cx("press flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#e8f0fe] text-[15px] font-semibold text-[#1a56c4] dark:bg-[#1b2a45] dark:text-[#93b8ff]", className)}>
        Em andamento · registrar <span aria-hidden>→</span>
      </Link>
    );
  }
  // travado: continua tocável (abre a visita para cancelar/remarcar), mas indica que o resultado ainda não libera
  return (
    <Link
      href={href}
      className={cx("press flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-dashed border-line-strong bg-tint px-4 text-[15px] font-semibold text-ink-3", className)}
      aria-label={`Resultado a partir das ${unlockLabel}. Cancelar ou remarcar já disponível.`}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      Resultado a partir das {unlockLabel}
    </Link>
  );
}
