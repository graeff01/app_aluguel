import { CaptureRequestsView } from "@/components/capture-requests-view";
import { demoRequests } from "@/server/demo-capture";
import { DemoNav } from "../nav";
import { DemoFeedback } from "../feedback";
import { DemoFoundForm } from "./found";
import { MarketNoteForm } from "@/components/market-note-form";

export const metadata = { title: "Demonstração · Pedidos para a captação" };

export default function DemoRequestsPage() {
  const rows = demoRequests();
  return (
    <>
      <DemoNav active="pedidos" open={rows.filter((r) => r.status === "SEARCHING").length} />
      <CaptureRequestsView rows={rows} renderFound={(id) => <DemoFoundForm id={id} />} renderMarket={(r) => <MarketNoteForm demo hidden={{ radarId: r.id }} label={r.marketTag ? "Atualizar parecer" : "Escrever parecer"} initial={{ tag: r.marketTag, text: r.marketNote, cents: r.marketCents }} />} />
      <DemoFeedback />
    </>
  );
}
