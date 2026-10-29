import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canSeeDemand, captureRequests, demandMap, segmentSupply } from "@/server/demand";
import { hasGlobalView } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { DemandView } from "@/components/demand-view";
import { canWriteMarket, listMarketNotes } from "@/server/market";
import { Suspense } from "react";
import { DemandRadar } from "@/components/demand-radar";

export const metadata = { title: "Mapa da demanda" };

export default async function DemandPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const actor = await requireActor({ capture: true });
  if (!canSeeDemand(actor)) notFound();
  const sp = await searchParams;
  const days = [30, 90, 180].includes(Number(sp.dias)) ? Number(sp.dias) : 90;
  const [d, notes, pedidos] = await Promise.all([demandMap(actor, { days }), listMarketNotes(), captureRequests(actor)]);
  return (
    <>
      <PageHeader title="Mapa da demanda" subtitle="O que os clientes procuram × o que há hoje no site." />
      <section aria-label="Radar da demanda" className="mb-6">
        <Suspense fallback={<div className="h-[52vh] min-h-[400px] animate-pulse rounded-3xl border border-line bg-tint md:h-[520px]" />}>
          <DemandRadar actor={actor} />
        </Suspense>
      </section>
      <DemandView d={d} days={days} basePath="/demanda" loadRows={() => segmentSupply(actor, d.segments)} notes={notes} write={canWriteMarket(actor)} pedidos={pedidos.filter((p) => p.status !== "CLOSED")} requestsLink={hasGlobalView(actor)} showBrief={hasGlobalView(actor)} />
    </>
  );
}
