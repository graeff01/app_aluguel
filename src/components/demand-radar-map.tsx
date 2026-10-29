"use client";
/**
 * Radar da demanda: manchas de calor por bairro que crescem, mudam de cor e "andam" semana a semana, como o radar
 * da previsão do tempo. Leaflet + OpenStreetMap; as manchas são desenhadas num canvas por cima (intensidade
 * acumulada → paleta de radar). Sem animação quando o aparelho pede movimento reduzido.
 */
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";
import type { DemandRadarData } from "@/server/demand-radar";
import { Icon } from "./icons";

const STEP_MS = 650;
const HOLD_MS = 450;
// paleta de radar: verde → amarelo → laranja → vermelho → magenta
const STOPS: [number, [number, number, number]][] = [
  [0.0, [58, 196, 110]],
  [0.35, [240, 210, 60]],
  [0.6, [243, 150, 45]],
  [0.82, [229, 72, 77]],
  [1.0, [190, 60, 200]],
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
    // borda que some aos poucos (sem serrilhado) e centro mais opaco
    out[i * 4 + 3] = Math.round(Math.min(1, t / 0.22) ** 1.5 * (120 + 100 * Math.min(1, t * 1.4)));
  }
  return out;
})();

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export default function DemandRadarMap({ data }: { data: DemandRadarData }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = useRef<LMap | null>(null);
  const labels = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const values = useRef<number[]>(data.frames.at(-1)?.counts ?? []);
  const last = data.frames.length - 1;
  const [frame, setFrame] = useState(last);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef(last);
  const maxV = Math.max(1, ...data.frames.flatMap((f) => f.counts));

  // desenha as manchas com os valores atuais (meia resolução, colorida pela paleta)
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
    data.areas.forEach((a, i) => {
      const v = values.current[i] ?? 0;
      if (v <= 0.01) return;
      const p = m.latLngToContainerPoint([a.lat, a.lng]);
      const q = m.latLngToContainerPoint([a.lat + (480 + 260 * Math.sqrt(v)) / 111_320, a.lng]);
      const r = Math.max(6, Math.abs(p.y - q.y)) / 2;
      const x = p.x / 2;
      const y = p.y / 2;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a0 = Math.min(1, 0.25 + 0.75 * (v / maxV));
      g.addColorStop(0, `rgba(0,0,0,${a0})`);
      g.addColorStop(0.45, `rgba(0,0,0,${a0 * 0.6})`);
      g.addColorStop(0.8, `rgba(0,0,0,${a0 * 0.18})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
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

  // nomes e números dos bairros do quadro atual (os mais procurados)
  const drawLabels = (f: number) => {
    const leaflet = L.current;
    const group = labels.current;
    if (!leaflet || !group) return;
    group.clearLayers();
    const counts = data.frames[f]?.counts ?? [];
    data.areas
      .map((a, i) => ({ a, v: counts[i] ?? 0 }))
      .filter((x) => x.v > 0)
      .sort((x, y) => y.v - x.v)
      .slice(0, 8)
      .forEach(({ a, v }) => {
        leaflet
          .marker([a.lat, a.lng], {
            interactive: false,
            keyboard: false,
            icon: leaflet.divIcon({ className: "dr-label-wrap", html: `<div class="dr-label"><b>${v}</b> ${a.name.replace(/</g, "")}</div>`, iconSize: [0, 0] }),
          })
          .addTo(group);
      });
  };

  // mapa (uma vez)
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
      labels.current = leaflet.layerGroup().addTo(m);
      if (data.areas.length) m.fitBounds(data.areas.map((a) => [a.lat, a.lng] as [number, number]), { padding: [48, 48], maxZoom: 14 });
      else m.setView([-29.917, -51.183], 13); // Canoas
      m.on("move zoom resize", draw);
      draw();
      drawLabels(frameRef.current);
      // começa tocando (uma volta), a menos que o aparelho peça menos movimento
      if (data.frames.length > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        frameRef.current = 0;
        values.current = [...data.frames[0].counts];
        setFrame(0);
        draw();
        drawLabels(0);
        setPlaying(true);
      }
    })();
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // transição suave até o quadro escolhido
  const goTo = (target: number, after?: () => void) => {
    const from = [...values.current];
    const to = data.frames[target]?.counts ?? [];
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = ease(Math.min(1, (t - t0) / STEP_MS));
      values.current = to.map((v, i) => (from[i] ?? 0) + (v - (from[i] ?? 0)) * k);
      draw();
      if (k < 1) raf = requestAnimationFrame(tick);
      else after?.();
    };
    raf = requestAnimationFrame(tick);
    frameRef.current = target;
    setFrame(target);
    drawLabels(target);
    return () => cancelAnimationFrame(raf);
  };

  // tocando: avança semana a semana e para no "Agora"
  useEffect(() => {
    if (!playing) return;
    let cancel: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      const f = frameRef.current;
      if (f >= last) return setPlaying(false);
      cancel = goTo(f + 1, () => {
        timer = setTimeout(next, HOLD_MS);
      });
    };
    timer = setTimeout(next, HOLD_MS);
    return () => {
      cancel?.();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const play = () => {
    if (frameRef.current >= last) {
      values.current = [...data.frames[0].counts];
      frameRef.current = 0;
      setFrame(0);
      draw();
      drawLabels(0);
    }
    setPlaying(true);
  };
  const total = data.frames[frame]?.counts.reduce((a, b) => a + b, 0) ?? 0;

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <div className="relative h-[52vh] min-h-[340px] md:h-[460px]">
        <div ref={box} className="absolute inset-0" />
        <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 z-[450] size-full" style={{ imageRendering: "auto" }} />
        <div className="pointer-events-none absolute top-3 left-3 z-[500] rounded-2xl bg-surface/90 px-3 py-2 shadow-card backdrop-blur">
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{data.frames[frame]?.label}</p>
          <p className="text-[15px] font-bold">
            <span className="num">{total}</span> procura{total === 1 ? "" : "s"} ativa{total === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      {/* espaço à direita para o botão de ajuda (fixo no canto) */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line py-2.5 pr-16 pl-3">
        <button
          type="button"
          onClick={() => (playing ? setPlaying(false) : play())}
          aria-label={playing ? "Pausar" : "Ver a demanda andando semana a semana"}
          className="press grid size-10 shrink-0 place-items-center rounded-full bg-primary text-on-primary"
        >
          {playing ? (
            <span aria-hidden className="flex gap-1">
              <span className="h-3.5 w-1 rounded-sm bg-current" />
              <span className="h-3.5 w-1 rounded-sm bg-current" />
            </span>
          ) : (
            <Icon name="play" className="size-4" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={last}
          value={frame}
          aria-label="Semana"
          aria-valuetext={data.frames[frame]?.label}
          onChange={(e) => {
            setPlaying(false);
            goTo(Number(e.target.value));
          }}
          className="min-w-0 flex-1 accent-[var(--accent)]"
        />
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3" aria-label="Legenda: de pouca a muita procura">
          pouca
          <span aria-hidden className="h-2 w-16 rounded-full" style={{ background: "linear-gradient(90deg,#3ac46e,#f0d23c,#f3962d,#e5484d,#be3cc8)" }} />
          muita
        </div>
      </div>
    </div>
  );
}
