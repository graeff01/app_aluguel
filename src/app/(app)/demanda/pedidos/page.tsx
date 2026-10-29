import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canSeeDemand, captureRequests } from "@/server/demand";
import { captureScoreboard } from "@/server/capture";
import { inventoryMatchCounts } from "@/server/site-inventory";
import { CaptureRequestsView, tabOf, type CaptureTab } from "@/components/capture-requests-view";

export const metadata = { title: "Pedidos para a captação" };

const TABS: CaptureTab[] = ["buscar", "meus", "indicados", "encerrados"];

export default async function CaptureRequestsPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const actor = await requireActor({ capture: true });
  if (!canSeeDemand(actor)) notFound();
  const [rows, board, sp] = await Promise.all([captureRequests(actor), captureScoreboard(actor), searchParams]);
  const showMine = actor.role === "CAPTURE";
  const options = await inventoryMatchCounts(rows.filter((r) => r.status === "SEARCHING").map((r) => ({ ...r, exclude: r.foundCodes })));
  // sem aba escolhida: o que é meu primeiro (se houver), senão o que precisa de alguém
  const asked = TABS.includes(sp.aba as CaptureTab) ? (sp.aba as CaptureTab) : null;
  const tab = asked ?? (showMine && rows.some((r) => tabOf(r, actor.id) === "meus") ? "meus" : "buscar");
  return <CaptureRequestsView rows={rows} actorId={actor.id} board={board} tab={tab === "meus" && !showMine ? "buscar" : tab} options={options} showMine={showMine} />;
}
