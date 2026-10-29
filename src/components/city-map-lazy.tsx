"use client";
import dynamic from "next/dynamic";

/** O mapa só existe no navegador (Leaflet usa window). */
export const CityMapLazy = dynamic(() => import("./city-map-view"), {
  ssr: false,
  loading: () => <div className="h-[56vh] min-h-[360px] animate-pulse rounded-3xl border border-line bg-tint lg:h-[calc(100dvh-260px)]" aria-label="Carregando o mapa" />,
});
