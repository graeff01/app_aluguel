import type { Metadata } from "next";
import { cookies } from "next/headers";
import { BrandLogo } from "@/components/brand";
import { clientDocView, SESSION_COOKIE } from "@/server/doc-requests";
import { getSettings } from "@/lib/settings";
import { ClientPortal, StateCard, VerifyStep } from "./portal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Envio de documentos", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Link público do cliente para enviar documentos (sem login; confirma identidade com dígitos do CPF ou celular). */
export default async function ClientDocsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await clientDocView(token, (await cookies()).get(SESSION_COOKIE)?.value);
  const retentionDays = (await getSettings().catch(() => null))?.preAnalysisRetentionDays ?? 90;

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line/70 bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-5 py-3.5">
          <BrandLogo tone="auto" className="h-8 w-auto" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-3 py-1.5 text-[12px] font-bold text-good">
            <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            Ambiente seguro
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-5 pt-7 pb-36">
        {view.state !== "OK" ? (
          <StateCard state={view.state} />
        ) : !view.verified ? (
          <VerifyStep token={token} firstName={view.firstName} consultant={view.consultant} property={view.property} verifyKind={view.verifyKind} locked={view.locked} />
        ) : (
          <ClientPortal
            token={token}
            firstName={view.firstName}
            consultant={view.consultant}
            property={view.property}
            message={view.message}
            initialItems={view.items}
            initialStatus={view.status}
            expiresAt={view.expiresAt.toISOString()}
            retentionDays={retentionDays}
          />
        )}
        <footer className="mt-12 text-center text-[12px] leading-relaxed text-ink-3">
          Auxiliadora Predial · Locação
          <br />
          <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            Aviso de privacidade
          </a>
        </footer>
      </main>
    </div>
  );
}
