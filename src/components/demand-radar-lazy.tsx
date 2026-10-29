"use client";
import dynamic from "next/dynamic";

/** O mapa só existe no navegador (Leaflet usa window). */
export const DemandRadarLazy = dynamic(() => import("./demand-radar-map"), {
  ssr: false,
  loading: () => <div className="h-[52vh] min-h-[400px] animate-pulse rounded-3xl border border-line bg-tint md:h-[520px]" aria-label="Carregando o radar da demanda" />,
});
