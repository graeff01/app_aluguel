"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * "← Voltar" que volta para a tela de onde a pessoa veio (com os filtros que estavam aplicados, ex.: Histórico da
 * consultora). Aberta direto (link do WhatsApp, notificação, nova aba): vai para `fallback`.
 */
export function BackLink({ fallback, className, children = "← Voltar", history = true }: { fallback: string; className?: string; children?: React.ReactNode; /** false: logo depois de um formulário (voltar levaria de volta a ele) */ history?: boolean }) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      className={className}
      onClick={(e) => {
        if (!history || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // nova aba: segue o link
        let sameSite = true;
        try {
          sameSite = !document.referrer || new URL(document.referrer).origin === window.location.origin;
        } catch {
          sameSite = true;
        }
        if (window.history.length > 1 && sameSite) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      {children}
    </Link>
  );
}
