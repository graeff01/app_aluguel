import { PageHeader } from "@/components/ui";
import { DemandView } from "@/components/demand-view";
import { supplyForSegments } from "@/server/demand";
import { demoDemand, demoMarketNotes, demoRequests } from "@/server/demo-capture";
import { DemoNav } from "./nav";
import { DemoFeedback } from "./feedback";

export const metadata = { title: "Demonstração · Mapa da demanda" };

export default async function DemoDemandPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const sp = await searchParams;
  const days = [30, 90, 180].includes(Number(sp.dias)) ? Number(sp.dias) : 90;
  const d = demoDemand(days);
  return (
    <>
      <DemoNav active="mapa" open={demoRequests().filter((r) => r.status === "SEARCHING").length} />
      <PageHeader title="Mapa da demanda" subtitle="O que os clientes procuram e não encontram, cruzado com o que existe hoje no site. Mostra onde a captação deve buscar." />
      <DemandView d={d} days={days} basePath="/demo/captacao" loadRows={() => supplyForSegments(d.segments)} notes={demoMarketNotes} write="demo" />
      <DemoFeedback />
    </>
  );
}
