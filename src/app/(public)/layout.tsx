import { getSettingsSafe } from "@/lib/settings-safe";
import { BrandLogo } from "@/components/brand";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettingsSafe();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Painel de marca (desktop) */}
      <aside className="relative hidden overflow-hidden bg-[#1f2124] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full border border-white/[0.06]" />
        <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-[280px] rounded-full border border-white/[0.06]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-24 size-[460px] rounded-full bg-accent/[0.08] blur-3xl" />
        <div className="relative">
          <BrandLogo tone="light" className="h-11 w-auto" />
          <p className="mt-3 text-[12px] font-semibold tracking-[0.16em] text-white/45 uppercase">{s.productName}</p>
        </div>
        <div className="relative max-w-md">
          <p className="mb-4 text-xs font-semibold tracking-[0.18em] text-accent uppercase">Locação</p>
          <p className="text-[40px] leading-[1.08] font-bold tracking-[-0.035em]">Cada visita registrada. Cada decisão com dados.</p>
          <p className="mt-5 text-[15px] leading-relaxed text-white/55">Registre o resultado logo após a visita e acompanhe o que realmente avança para locação.</p>
        </div>
        <p className="relative text-[13px] text-white/35">Acesso restrito à equipe</p>
      </aside>

      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <BrandLogo tone="auto" className="h-10 w-auto" />
            <p className="mt-2.5 text-[12px] font-semibold tracking-[0.16em] text-ink-3 uppercase">{s.productName}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
