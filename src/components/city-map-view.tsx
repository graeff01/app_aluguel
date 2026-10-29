"use client";
/**
 * Mapa de Canoas: manchas de calor da procura (por bairro) e um selo com quantos imóveis nossos há no site em
 * cada bairro (cor = situação: sem imóvel, pouca oferta, temos oferta). Tocar num bairro abre o painel com a procura
 * e os imóveis do site daquele bairro. Leaflet + OpenStreetMap; a procura é desenhada num canvas por cima.
 */
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Map as LMap, Marker } from "leaflet";
import type { AreaDetail, CityMapData } from "@/server/city-map";
import { areaDetailAction } from "@/app/actions/city-map";
import { ListingStrip } from "./listing-strip";
import { cx } from "./ui";

type Area = CityMapData["areas"][number];
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const STATUS = {
  none: { label: "Procura sem imóvel nosso", color: "#d8453b", chip: "bg-bad-soft text-bad" },
  low: { label: "Pouca oferta para a procura", color: "#e08a1e", chip: "bg-warn-soft text-warn" },
  ok: { label: "Temos oferta", color: "#2f9e5a", chip: "bg-good-soft text-good" },
  idle: { label: "Imóveis sem procura agora", color: "#5b6470", chip: "bg-tint text-ink-2" },
} as const;

// paleta da procura (verde → amarelo → laranja → vermelho), com borda que some aos poucos
const STOPS: [number, [number, number, number]][] = [
  [0.0, [58, 196, 110]],
  [0.4, [240, 210, 60]],
  [0.7, [243, 150, 45]],
  [1.0, [229, 72, 77]],
];
const PALETTE = (() => {
  const out = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < STOPS.length - 2 && t > STOPS[j + 1][0]) j++;
    const [t0, c0] = STOPS[j];
    const [t1, c1] = STOPS[j + 1];
    const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(c0[c] + (c1[c] - c0[c]) * k);
    out[i * 4 + 3] = Math.round(Math.min(1, t / 0.22) ** 1.5 * (110 + 90 * Math.min(1, t * 1.4)));
  }
  return out;
})();

function badgeHtml(a: Area, selected: boolean, showSupply: boolean) {
  const s = STATUS[a.status];
  const n = showSupply ? a.res : a.demand;
  return `<button type="button" class="cm-badge${selected ? " is-sel" : ""}" style="--c:${showSupply ? s.color : "#26292c"}" aria-label="${a.name.replace(/"/g, "")}"><b>${n}</b><span>${a.name.replace(/</g, "")}</span></button>`;
}

export default function CityMapView({ data }: { data: CityMapData }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = useRef<LMap | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const [layers, setLayers] = useState({ demand: true, supply: true });
  const layersRef = useRef(layers);
  const [sel, setSel] = useState<Area | null>(null);
  const [detail, setDetail] = useState<AreaDetail | null>(null);
  const [pending, start] = useTransition();
  const maxV = Math.max(1, ...data.areas.map((a) => a.demand));

  const draw = () => {
    const m = map.current;
    const cv = canvas.current;
    if (!m || !cv) return;
    const size = m.getSize();
    const w = Math.max(1, Math.round(size.x / 2));
    const h = Math.max(1, Math.round(size.y / 2));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!layersRef.current.demand) return;
    for (const a of data.areas) {
      if (!a.demand) continue;
      const p = m.latLngToContainerPoint([a.lat, a.lng]);
      const q = m.latLngToContainerPoint([a.lat + (260 + 130 * Math.sqrt(a.demand)) / 111_320, a.lng]);
      const r = Math.max(5, Math.abs(p.y - q.y)) / 2;
      const g = ctx.createRadialGradient(p.x / 2, p.y / 2, 0, p.x / 2, p.y / 2, r);
      const a0 = Math.min(1, 0.3 + 0.7 * (a.demand / maxV));
      g.addColorStop(0, `rgba(0,0,0,${a0})`);
      g.addColorStop(0.45, `rgba(0,0,0,${a0 * 0.6})`);
      g.addColorStop(0.8, `rgba(0,0,0,${a0 * 0.18})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x / 2, p.y / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const k = px[i + 3] * 4;
      px[i] = PALETTE[k];
      px[i + 1] = PALETTE[k + 1];
      px[i + 2] = PALETTE[k + 2];
      px[i + 3] = PALETTE[k + 3];
    }
    ctx.putImageData(img, 0, 0);
  };

  const refreshBadges = (selKey: string | null) => {
    const leaflet = L.current;
    if (!leaflet) return;
    for (const a of data.areas) {
      const mk = markers.current.get(a.key);
      if (!mk) continue;
      // sem a camada de imóveis, o selo mostra a procura; bairros só com imóveis somem
      const visible = layersRef.current.supply || a.demand > 0;
      mk.setOpacity(visible ? 1 : 0);
      mk.setIcon(leaflet.divIcon({ className: "cm-badge-wrap", html: badgeHtml(a, a.key === selKey, layersRef.current.supply), iconSize: [0, 0] }));
      mk.setZIndexOffset(a.key === selKey ? 1000 : a.demand);
    }
  };

  const open = (a: Area) => {
    setSel(a);
    setDetail(null);
    refreshBadges(a.key);
    map.current?.panTo([a.lat, a.lng], { animate: true });
    start(async () => setDetail(await areaDetailAction(a.key)));
    if (window.matchMedia("(max-width: 1023px)").matches) setTimeout(() => document.getElementById("cm-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  };

  useEffect(() => {
    let disposed = false;
    (async () => {
      const leaflet = await import("leaflet");
      if (disposed || !box.current || map.current) return;
      L.current = leaflet;
      const m = leaflet.map(box.current, { zoomControl: false, attributionControl: true });
      map.current = m;
      m.attributionControl.setPrefix(false);
      leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 17, className: "rm-tiles", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(m);
      leaflet.control.zoom({ position: "topright" }).addTo(m);
      for (const a of data.areas) {
        const mk = leaflet.marker([a.lat, a.lng], { icon: leaflet.divIcon({ className: "cm-badge-wrap", html: badgeHtml(a, false, true), iconSize: [0, 0] }), keyboard: true, title: a.name, zIndexOffset: a.demand }).addTo(m);
        mk.on("click", () => open(a));
        markers.current.set(a.key, mk);
      }
      if (data.areas.length) m.fitBounds(data.areas.map((a) => [a.lat, a.lng] as [number, number]), { padding: [36, 36], maxZoom: 14 });
      else m.setView([-29.917, -51.183], 13); // Canoas
      m.on("move zoom resize", draw);
      // afastado (cidade inteira), o selo mostra só o número; o nome aparece ao aproximar ou no bairro escolhido
      const compact = () => box.current?.classList.toggle("cm-compact", m.getZoom() < 14);
      m.on("zoomend", compact);
      compact();
      draw();
    })();
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (k: "demand" | "supply") => {
    const next = { ...layersRef.current, [k]: !layersRef.current[k] };
    layersRef.current = next;
    setLayers(next);
    draw();
    refreshBadges(sel?.key ?? null);
  };

  const none = data.areas.filter((a) => a.status === "none").slice(0, 6);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="min-w-0">
        <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
          <div className="relative h-[56vh] min-h-[360px] lg:h-[calc(100dvh-260px)] lg:min-h-[520px]">
            <div ref={box} className="absolute inset-0" />
            <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 z-[450] size-full" />
            <div className="absolute top-3 left-3 z-[500] flex flex-wrap gap-1.5">
              {(
                [
                  ["demand", "Procura"],
                  ["supply", "Nossos imóveis"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={layers[k]} onClick={() => toggle(k)} className={cx("press min-h-9 rounded-full px-3 text-[13px] font-semibold shadow-card backdrop-blur", layers[k] ? "bg-primary text-on-primary" : "bg-surface/90 text-ink-2")}>
                  {layers[k] ? "✓ " : ""}
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line py-2.5 pr-16 pl-3 text-[12px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-12 rounded-full" style={{ background: "linear-gradient(90deg,#3ac46e,#f0d23c,#f3962d,#e5484d)" }} />
              procura
            </span>
            {(["none", "low", "ok"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: STATUS[k].color }} />
                {k === "none" ? "sem imóvel nosso" : k === "low" ? "pouca oferta" : "temos oferta"}
              </span>
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-[12px] text-ink-3">
          {data.totals.demand} cliente{data.totals.demand === 1 ? "" : "s"} procurando · {data.totals.res} residenciais e {data.totals.com} comerciais nossos no site
          {data.inventoryAt ? ` (lido em ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(data.inventoryAt))})` : " (primeira leitura do site em andamento)"}
          {data.missing ? ` · ${data.missing} bairro${data.missing > 1 ? "s" : ""} ainda sendo localizado${data.missing > 1 ? "s" : ""}` : ""}. O número no selo é quantos imóveis nossos há no bairro.
        </p>
      </div>

      <aside id="cm-panel" className="min-w-0 scroll-mt-20 rounded-3xl border border-line bg-surface p-4 shadow-card lg:sticky lg:top-24 lg:max-h-[calc(100dvh-120px)] lg:overflow-y-auto">
        {!sel ? (
          <>
            <p className="text-[15px] font-bold">Toque num bairro</p>
            <p className="mt-0.5 text-[13px] text-ink-3">Veja o que os clientes procuram ali e os nossos imóveis do bairro no site.</p>
            {none.length > 0 && (
              <>
                <p className="mt-4 mb-2 text-[13px] font-semibold">Procura sem nenhum imóvel nosso</p>
                <ul className="space-y-1.5">
                  {none.map((a) => (
                    <li key={a.key}>
                      <button type="button" onClick={() => open(a)} className="press flex w-full items-center justify-between rounded-xl border border-bad/30 bg-bad-soft px-3 py-2 text-left text-[14px]">
                        <span className="font-semibold">{a.name}</span>
                        <span className="text-[13px] text-bad">
                          {a.demand} procurando · 0 nossos
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[18px] font-bold">{sel.name}</p>
                <span className={cx("mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-bold", STATUS[sel.status].chip)}>{STATUS[sel.status].label}</span>
              </div>
              <button type="button" onClick={() => (setSel(null), refreshBadges(null))} className="press -mt-1 -mr-1 grid size-9 place-items-center rounded-full text-ink-3 hover:bg-tint" aria-label="Fechar">
                ✕
              </button>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {(
                [
                  [String(sel.demand), "procurando"],
                  [String(sel.res), "residenciais"],
                  [String(sel.com), "comerciais"],
                ] as const
              ).map(([v, k]) => (
                <div key={k} className="rounded-2xl bg-surface-2 px-2 py-2">
                  <dt className="sr-only">{k}</dt>
                  <dd className="num text-[20px] leading-tight font-bold">{v}</dd>
                  <dd className="text-[11px] text-ink-3">{k}</dd>
                </div>
              ))}
            </dl>
            {pending && !detail ? (
              <p className="mt-4 text-[13px] text-ink-3">Carregando o bairro…</p>
            ) : detail ? (
              <>
                {detail.demand > 0 && (
                  <div className="mt-4">
                    <p className="text-[13px] font-semibold">O que procuram</p>
                    <p className="mt-1 text-[14px] text-ink-2">
                      {detail.types.map((t) => `${t.n} ${t.label.toLowerCase()}`).join(" · ")}
                      {detail.bedrooms ? ` · ${detail.bedrooms}+ quartos` : ""}
                      {detail.budgetCents ? ` · até ${brl(detail.budgetCents)}` : ""}
                    </p>
                  </div>
                )}
                <div className="mt-4">
                  <p className="mb-2 text-[13px] font-semibold">Nossos imóveis no bairro {detail.listings.length ? `· ${detail.listings.length}${detail.listings.length >= 40 ? "+" : ""}` : ""}</p>
                  {detail.listings.length ? (
                    <ListingStrip
                      items={detail.listings}
                      pedidos={detail.pedidos.map((p) => ({ id: p.id, foundCodes: p.foundCodes, label: [p.propertyType ?? "Imóvel", p.bedrooms ? `${p.bedrooms}+ qtos` : null, p.maxBudgetCents ? `até ${brl(p.maxBudgetCents)}` : null].filter(Boolean).join(" · ") }))}
                    />
                  ) : (
                    <p className="rounded-2xl border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">Nenhum imóvel nosso no site neste bairro: oportunidade de captação.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-4 text-[13px] text-ink-3">Não foi possível carregar agora.</p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
