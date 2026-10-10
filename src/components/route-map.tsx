"use client";
/**
 * Mapa da rota do dia (Leaflet + OpenStreetMap). Marcadores numerados na ordem dos horários,
 * linha do trajeto de carro, "onde estou" (só no aparelho, nada é enviado ao servidor)
 * e mini-cards deslizantes sincronizados com o mapa.
 */
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Map as LMap, Marker, LatLngBoundsExpression } from "leaflet";
import { cx } from "./ui";
import { Icon } from "./icons";
import { PropertyThumb } from "./property-thumb";

export type MapStop = {
  id: string;
  n: number;
  time: string;
  end: string;
  status: string;
  tone: "done" | "live" | "next" | "later" | "late";
  client: string;
  code: string | null;
  area: string | null;
  address: string | null;
  approximate: boolean;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  href: string | null;
  mapsUrl: string | null;
  wazeUrl: string | null;
  driveMin: number | null;
  driveKm: number | null;
  gapMin: number | null;
  tight: boolean;
};

const TONE_COLOR: Record<MapStop["tone"], string> = {
  done: "#9aa0a7",
  live: "#2f6fde",
  next: "#dc7519",
  later: "#26292c",
  late: "#c2452d",
};

function pinHtml(s: MapStop, selected: boolean) {
  const c = TONE_COLOR[s.tone];
  return `<div class="rm-pin${selected ? " is-sel" : ""}${s.approximate ? " is-approx" : ""}" style="--c:${c}"><span>${s.n}</span></div>`;
}

export default function RouteMap({ stops, line, totalDriveMin }: { stops: MapStop[]; line: [number, number][] | null; totalDriveMin: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const L = useRef<typeof import("leaflet") | null>(null);
  const located = stops.filter((s) => s.lat != null && s.lng != null);
  const firstPending = located.find((s) => s.tone === "live" || s.tone === "next" || s.tone === "late") ?? located[0];
  const [sel, setSel] = useState<string | null>(firstPending?.id ?? null);
  const [locating, setLocating] = useState<"idle" | "busy" | "denied">("idle");
  const fromStrip = useRef(false);

  // cria o mapa uma vez
  useEffect(() => {
    let disposed = false;
    (async () => {
      const leaflet = await import("leaflet");
      if (disposed || !box.current || map.current) return;
      L.current = leaflet;
      const m = leaflet.map(box.current, { zoomControl: false, attributionControl: true, tap: true } as never);
      map.current = m;
      m.attributionControl.setPrefix(false);
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          className: "rm-tiles",
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
        })
        .addTo(m);
      leaflet.control.zoom({ position: "topright" }).addTo(m);
      if (line && line.length > 1) {
        leaflet.polyline(line, { color: "#ffffff", weight: 9, opacity: 0.9, lineCap: "round", lineJoin: "round" }).addTo(m);
        leaflet.polyline(line, { color: "#dc7519", weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(m);
      } else if (located.length > 1) {
        // sem trajeto (serviço indisponível): ligação simples, tracejada
        leaflet.polyline(located.map((s) => [s.lat!, s.lng!] as [number, number]), { color: "#dc7519", weight: 3, dashArray: "6 8", opacity: 0.8 }).addTo(m);
      }
      for (const s of located) {
        const mk = leaflet
          .marker([s.lat!, s.lng!], { icon: leaflet.divIcon({ className: "rm-pin-wrap", html: pinHtml(s, s.id === sel), iconSize: [36, 44], iconAnchor: [18, 42] }), keyboard: true, title: `${s.n}. ${s.time} ${s.code ?? ""}` })
          .addTo(m)
          .on("click", () => {
            fromStrip.current = false;
            setSel(s.id);
          });
        markers.current.set(s.id, mk);
      }
      const pts = [...located.map((s) => [s.lat!, s.lng!] as [number, number]), ...(line ?? [])];
      if (pts.length) m.fitBounds(pts as LatLngBoundsExpression, { paddingTopLeft: [28, 28], paddingBottomRight: [28, 190], maxZoom: 15 });
      else m.setView([-29.917, -51.183], 13); // Canoas
    })();
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    };
    // mapa montado uma vez por conjunto de paradas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(located.map((s) => [s.id, s.lat, s.lng])), JSON.stringify(line?.length ?? 0)]);

  // seleção: destaca o marcador, centraliza e rola o mini-card
  useEffect(() => {
    const leaflet = L.current;
    for (const s of located) {
      const mk = markers.current.get(s.id);
      if (mk && leaflet) {
        mk.setIcon(leaflet.divIcon({ className: "rm-pin-wrap", html: pinHtml(s, s.id === sel), iconSize: [36, 44], iconAnchor: [18, 42] }));
        mk.setZIndexOffset(s.id === sel ? 1000 : 0);
      }
    }
    const s = located.find((x) => x.id === sel);
    if (s && map.current) {
      const m = map.current;
      const target = m.project([s.lat!, s.lng!], m.getZoom()).add([0, 70]); // compensa os cards embaixo
      m.panTo(m.unproject(target, m.getZoom()), { animate: true, duration: 0.45 });
    }
    if (!fromStrip.current && sel) document.getElementById(`rm-card-${sel}`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    fromStrip.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  // card centralizado ao deslizar → seleciona no mapa
  const onScroll = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best: { id: string; d: number } | null = null;
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const d = Math.abs(child.offsetLeft + child.offsetWidth / 2 - mid);
      if (!best || d < best.d) best = { id: child.dataset.id!, d };
    }
    if (best && best.id !== sel) {
      fromStrip.current = true;
      setSel(best.id);
    }
  }, [sel]);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function locate() {
    if (!navigator.geolocation || !map.current || !L.current) return;
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const leaflet = L.current!;
        const m = map.current!;
        const here: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        leaflet.marker(here, { icon: leaflet.divIcon({ className: "rm-pin-wrap", html: '<div class="rm-me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false }).addTo(m);
        const pts = [here, ...located.map((s) => [s.lat!, s.lng!] as [number, number])];
        m.fitBounds(pts, { paddingTopLeft: [28, 28], paddingBottomRight: [28, 190], maxZoom: 15 });
        setLocating("idle");
      },
      () => setLocating("denied"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="relative mb-4 overflow-hidden rounded-[26px] border border-line bg-tint shadow-card">
      <div ref={box} className="h-[62vh] min-h-[380px] w-full md:h-[560px] lg:h-[calc(100dvh-230px)] lg:min-h-[520px]" role="region" aria-label="Mapa da rota" />

      <div className="pointer-events-none absolute top-3 left-3 z-[500] flex flex-col items-start gap-2">
        <span className="pointer-events-auto rounded-full bg-surface/90 px-3 py-1.5 text-[12px] font-semibold text-ink shadow-card backdrop-blur">
          {located.length} {located.length === 1 ? "parada" : "paradas"} no mapa
          {totalDriveMin != null && located.length > 1 ? ` · ~${totalDriveMin} min de carro` : ""}
        </span>
        {located.length < stops.length && (
          <span className="pointer-events-auto rounded-full bg-accent-soft px-3 py-1 text-[12px] font-semibold text-accent-strong shadow-card">
            {stops.length - located.length} sem localização · veja a lista
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={locate}
        className="press absolute top-[92px] right-[10px] z-[500] grid size-[34px] place-items-center rounded-lg border border-black/15 bg-surface text-ink shadow-card"
        aria-label="Mostrar onde estou"
        title={locating === "denied" ? "Localização não permitida no aparelho" : "Onde estou"}
      >
        {locating === "busy" ? <span className="size-3 animate-ping rounded-full bg-[#2f6fde]" /> : <Icon name="pin" className={cx("size-[18px]", locating === "denied" && "text-ink-3")} />}
      </button>

      {stops.length > 0 && (
        <div
          ref={strip}
          onScroll={() => {
            if (scrollTimer.current) clearTimeout(scrollTimer.current);
            scrollTimer.current = setTimeout(onScroll, 90);
          }}
          className="rm-strip absolute inset-x-0 bottom-3 z-[500] flex snap-x snap-mandatory gap-3 overflow-x-auto px-[9%] pb-1"
        >
          {stops.map((s) => {
            const active = s.id === sel;
            return (
              <article
                key={s.id}
                id={`rm-card-${s.id}`}
                data-id={s.id}
                onClick={() => {
                  if (s.lat != null) {
                    fromStrip.current = true;
                    setSel(s.id);
                  }
                }}
                className={cx(
                  "w-[82%] max-w-[340px] shrink-0 snap-center rounded-[22px] border bg-surface/95 p-3.5 shadow-float backdrop-blur-xl transition",
                  active ? "border-ink/25" : "border-line opacity-90",
                  s.tone === "done" && "opacity-75",
                )}
              >
                <div className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white" style={{ background: TONE_COLOR[s.tone] }}>
                    {s.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-ink-3">
                      <span className="num text-[14px] font-bold text-ink">{s.time}</span>–{s.end} · {s.status}
                    </p>
                    <p className="truncate text-[15px] leading-snug font-bold">{s.client}</p>
                    <p className="truncate text-[12px] text-ink-2">
                      <span className="num font-semibold">{s.code ?? "sem código"}</span>
                      {s.area ? ` · ${s.area}` : ""}
                      {s.approximate ? " · local aproximado" : ""}
                      {s.lat == null ? " · sem localização" : ""}
                    </p>
                  </div>
                  <PropertyThumb photoUrl={s.photoUrl} className="size-12" />
                </div>
                {s.driveMin != null && (
                  <p className={cx("mt-2 rounded-xl px-2.5 py-1 text-[12px] font-semibold", s.tight ? "bg-accent-soft text-accent-strong" : "bg-tint text-ink-2")}>
                    {s.tight ? "Apertado: " : ""}~{s.driveMin} min de carro ({s.driveKm?.toLocaleString("pt-BR")} km)
                    {s.gapMin != null ? ` · ${s.gapMin < 0 ? "horário sobreposto" : `${s.gapMin} min de intervalo`}` : ""}
                  </p>
                )}
                <div className="mt-2.5 flex gap-2">
                  {s.mapsUrl && (
                    <a href={s.mapsUrl} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary text-[13px] font-semibold text-on-primary" onClick={(e) => e.stopPropagation()}>
                      <Icon name="route" className="size-4" /> Ir
                    </a>
                  )}
                  {s.wazeUrl && (
                    <a href={s.wazeUrl} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-10 items-center rounded-full bg-tint px-4 text-[13px] font-semibold" onClick={(e) => e.stopPropagation()}>
                      Waze
                    </a>
                  )}
                  {s.href && (
                    <Link href={s.href} className="press inline-flex min-h-10 items-center rounded-full bg-tint px-4 text-[13px] font-semibold" onClick={(e) => e.stopPropagation()}>
                      Abrir
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
