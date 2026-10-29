import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canSeeDemand } from "@/server/demand";
import { cityMap } from "@/server/city-map";
import { PageHeader } from "@/components/ui";
import { CityMapLazy } from "@/components/city-map-lazy";

export const metadata = { title: "Mapa de Canoas" };

/** Procura dos clientes × imóveis nossos no site, por bairro. */
export default async function CityMapPage() {
  const actor = await requireActor({ capture: true });
  if (!canSeeDemand(actor)) notFound();
  const data = await cityMap(actor, { geocode: 2 });
  return (
    <>
      <PageHeader title="Mapa de Canoas" subtitle="Onde os clientes procuram e onde já temos imóvel. Toque num bairro para ver os detalhes." />
      {data.areas.length ? (
        <CityMapLazy data={data} />
      ) : (
        <p className="rounded-3xl border border-dashed border-line-strong bg-surface-2 p-5 text-[14px] text-ink-3">Preparando o mapa: o app está lendo os imóveis do site e localizando os bairros. Volte em alguns minutos.</p>
      )}
    </>
  );
}
