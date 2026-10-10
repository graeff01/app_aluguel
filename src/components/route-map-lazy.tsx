"use client";
import dynamic from "next/dynamic";

/** O mapa só existe no navegador (Leaflet usa window). */
export const RouteMapLazy = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => <div className="mb-4 h-[62vh] min-h-[380px] animate-pulse rounded-[26px] border border-line bg-tint md:h-[560px] lg:h-[calc(100dvh-230px)] lg:min-h-[520px]" aria-label="Carregando mapa" />,
});
