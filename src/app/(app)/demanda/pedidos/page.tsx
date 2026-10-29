import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canSeeDemand, captureRequests } from "@/server/demand";
import { CaptureRequestsView } from "@/components/capture-requests-view";
import { CaptureFoundForm } from "./found-form";
import { MarketNoteForm } from "@/components/market-note-form";

export const metadata = { title: "Pedidos para a captação" };

export default async function CaptureRequestsPage() {
  const actor = await requireActor({ capture: true });
  if (!canSeeDemand(actor)) notFound();
  const rows = await captureRequests(actor);
  return (
    <>
      <Link href="/demanda" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Mapa da demanda
      </Link>
      <CaptureRequestsView rows={rows} renderFound={(id) => <CaptureFoundForm id={id} />} renderMarket={(r) => <MarketNoteForm hidden={{ radarId: r.id }} label={r.marketTag ? "Atualizar parecer" : "Escrever parecer"} initial={{ tag: r.marketTag, text: r.marketNote, cents: r.marketCents }} />} />
    </>
  );
}
