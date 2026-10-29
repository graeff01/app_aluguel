import type { AuthzActor } from "@/lib/authz";
import { demandRadar } from "@/server/demand-radar";
import { DemandRadarLazy } from "./demand-radar-lazy";

/** Radar da demanda (carrega depois do resto da página): geocodifica aos poucos os bairros que faltam. */
export async function DemandRadar({ actor }: { actor: AuthzActor }) {
  const data = await demandRadar(actor, new Date(), { geocode: 2 });
  if (!data.areas.length)
    return (
      <p className="rounded-3xl border border-dashed border-line-strong bg-surface-2 p-5 text-[14px] text-ink-3">
        Preparando o mapa: o app está localizando os bairros pedidos. Volte em alguns minutos.
      </p>
    );
  return (
    <>
      <DemandRadarLazy data={data} />
      {data.missing > 0 && <p className="mt-1.5 text-[12px] text-ink-3">{data.missing} bairro{data.missing > 1 ? "s" : ""} ainda sendo localizado{data.missing > 1 ? "s" : ""} no mapa.</p>}
    </>
  );
}
