import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canSeeDemand, demandMap, segmentSupply } from "@/server/demand";
import { PageHeader } from "@/components/ui";
import { DemandView } from "@/components/demand-view";

export const metadata = { title: "Mapa da demanda" };

export default async function DemandPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const actor = await requireActor({ capture: true });
  if (!canSeeDemand(actor)) notFound();
  const sp = await searchParams;
  const days = [30, 90, 180].includes(Number(sp.dias)) ? Number(sp.dias) : 90;
  const d = await demandMap(actor, { days });
  return (
    <>
      <PageHeader title="Mapa da demanda" subtitle="O que os clientes procuram e não encontram, cruzado com o que existe hoje no site. Mostra onde a captação deve buscar." />
      <DemandView d={d} days={days} basePath="/demanda" loadRows={() => segmentSupply(actor, d.segments)} />
    </>
  );
}
