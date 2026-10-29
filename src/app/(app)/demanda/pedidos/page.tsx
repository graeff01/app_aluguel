import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canSeeDemand, captureRequests } from "@/server/demand";
import { CaptureRequestsView } from "@/components/capture-requests-view";
import { CaptureFoundForm } from "./found-form";
import { MarketNoteForm } from "@/components/market-note-form";
import { Suspense } from "react";
import { PedidoOptions } from "./options";
import { captureScoreboard } from "@/server/capture";
import { CaptureOwnerButton } from "@/components/capture-owner";

export const metadata = { title: "Pedidos para a captação" };

export default async function CaptureRequestsPage() {
  const actor = await requireActor({ capture: true });
  if (!canSeeDemand(actor)) notFound();
  const [rows, board] = await Promise.all([captureRequests(actor), captureScoreboard(actor)]);
  return (
    <>
      {actor.role !== "CAPTURE" && (
        <Link href="/demanda" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
          ← Mapa da demanda
        </Link>
      )}
      <CaptureRequestsView
        rows={rows}
        actorId={actor.id}
        board={board}
        renderOwner={(r) => (actor.role === "CAPTURE" ? <CaptureOwnerButton id={r.id} mine={r.captureOwnerId === actor.id} taken={!!r.captureOwnerId} /> : null)}
        renderFound={(id) => <CaptureFoundForm id={id} />}
        renderMarket={(r) => <MarketNoteForm hidden={{ radarId: r.id }} label={r.marketTag ? "Editar parecer" : "+ Parecer de mercado"} initial={{ tag: r.marketTag, text: r.marketNote, cents: r.marketCents }} compact />}
        renderOptions={(r) => (
          <Suspense fallback={<p className="text-[13px] text-ink-3">Buscando no site…</p>}>
            <PedidoOptions r={r} />
          </Suspense>
        )}
      />
    </>
  );
}
