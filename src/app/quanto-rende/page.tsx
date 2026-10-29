import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand";
import { OWNER_TYPES } from "@/server/owner-leads";
import { OwnerTool } from "./tool";

export const metadata: Metadata = {
  title: "Quanto rende o seu imóvel? · Auxiliadora Predial",
  description: "Descubra em segundos quanto o seu imóvel pode render de aluguel em Canoas e quantos clientes procuram um imóvel como o seu agora.",
};

// bairros de Canoas (sugestões: dá para digitar outro)
const AREAS = ["Brigadeira", "Centro", "Estância Velha", "Fátima", "Guajuviras", "Harmonia", "Igara", "Industrial", "Marechal Rondon", "Mathias Velho", "Mato Grande", "Niterói", "Nossa Senhora das Graças", "Olaria", "Rio Branco", "São José", "São Luís", "São Vicente"];

/** Página pública para proprietários: estimativa de aluguel + demanda real e pedido de contato da captação. */
export default function OwnerPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line/70 bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-3.5">
          <BrandLogo tone="auto" className="h-8 w-auto" />
          <span className="text-[12px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Locação · Canoas</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 pt-8 pb-24">
        <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-accent-strong uppercase">Para proprietários</p>
        <h1 className="text-[34px] leading-[1.08] font-bold tracking-[-0.035em] sm:text-[42px]">Quanto rende o seu imóvel?</h1>
        <p className="mt-3 text-[16px] text-ink-2">Em segundos: o aluguel de imóveis parecidos com o seu e quantos clientes da Auxiliadora procuram um imóvel assim agora.</p>
        <OwnerTool areas={AREAS} types={[...OWNER_TYPES]} />
      </main>
    </div>
  );
}
