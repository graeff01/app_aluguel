import Link from "next/link";
import { cx } from "./ui";

/** Atalho para a ficha única do cliente (linha do tempo com tudo o que aconteceu com ele). */
export function ClientFileLink({ clientId, className }: { clientId: string | null | undefined; className?: string }) {
  if (!clientId) return null;
  return (
    <Link href={`/clientes/${clientId}`} className={cx("press inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-semibold shadow-card", className)}>
      <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
      Ficha do cliente
    </Link>
  );
}
