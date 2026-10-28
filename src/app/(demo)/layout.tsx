import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Demonstrações públicas (sem login), com dados fictícios. */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <BrandLogo tone="auto" className="h-8 w-auto" />
          <span className="rounded-full bg-warn-soft px-3 py-1 text-[12px] font-bold text-warn">Demonstração · dados fictícios</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
