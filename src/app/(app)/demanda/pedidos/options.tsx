import { findSimilarOnSite } from "@/server/site-search";
import { ListingStrip } from "@/components/listing-strip";
import type { CaptureRow } from "@/components/capture-requests-view";

/** Opções no site com o perfil do pedido (carrega depois da página): a captação indica com um toque. */
export async function PedidoOptions({ r }: { r: CaptureRow }) {
  const res = await findSimilarOnSite({ ...r, exclude: r.foundCodes }, { limit: 8 });
  if (res.error) return <p className="text-[13px] text-ink-3">O site não respondeu agora. Tente de novo mais tarde.</p>;
  if (!res.items.length) return <p className="text-[13px] font-semibold text-ink-2">Nada no site com esse perfil: é para a captação buscar.</p>;
  return (
    <>
      <p className="mb-2 text-[13px] font-semibold">No site com esse perfil · {res.items.length}</p>
      <ListingStrip items={res.items} pedidos={[{ id: r.id, label: "", foundCodes: r.foundCodes }]} moreUrl={res.moreUrl ?? undefined} />
    </>
  );
}
