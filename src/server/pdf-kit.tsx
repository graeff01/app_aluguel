/**
 * Peças comuns dos PDFs (relatório mensal e relatório do imóvel): fontes, cores, cartões, barras, tabelas.
 */
import path from "node:path";
import { Font, G, Image, Page, Polygon, StyleSheet, Svg, Polyline, Circle, Text, View } from "@react-pdf/renderer";
import type { Rate } from "@/lib/metrics";

export const ASSETS = path.join(process.cwd(), "assets");
let fontsReady = false;
export function ensureFonts() {
  if (fontsReady) return;
  Font.register({
    family: "Manrope",
    fonts: [400, 500, 600, 700, 800].map((w) => ({ src: path.join(ASSETS, "fonts", `manrope-latin-${w}-normal.woff`), fontWeight: w })),
  });
  Font.registerHyphenationCallback((w) => [w]);
  fontsReady = true;
}

export const C = {
  ink: "#1d2023",
  ink2: "#4d535a",
  ink3: "#80868e",
  line: "#e8e4dd",
  tint: "#f7f5f1",
  accent: "#dc7519",
  accentSoft: "#fbefe3",
  graphite: "#26292c",
  good: "#3f7a34",
  goodSoft: "#e9f2e4",
  bad: "#a8402d",
  badSoft: "#f8e8e4",
  blue: "#3b6fb6",
};

export const s = StyleSheet.create({
  page: { fontFamily: "Manrope", fontSize: 9, color: C.ink2, paddingTop: 70, paddingBottom: 52, paddingHorizontal: 40, backgroundColor: "#ffffff" },
  header: { position: "absolute", top: 26, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  headerRight: { fontSize: 8, color: C.ink3, textAlign: "right" },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: C.ink3 },
  eyebrow: { fontSize: 8, fontWeight: 700, color: C.accent, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 4 },
  h1: { fontSize: 24, fontWeight: 800, color: C.ink, letterSpacing: -0.6 },
  h2: { fontSize: 13, fontWeight: 800, color: C.ink, letterSpacing: -0.3, marginBottom: 2 },
  hint: { fontSize: 8, color: C.ink3, marginBottom: 8 },
  section: { marginBottom: 18 },
  card: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12 },
  row: { flexDirection: "row" },
});

// ─────────── formatação ───────────
export const nf1 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export function ppDelta(cur: Rate, prev: Rate) {
  if (cur.value === null || prev.value === null) return null;
  return Math.round((cur.value - prev.value) * 1000) / 10;
}
export function relDelta(cur: number, prev: number) {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Seta desenhada (a fonte embutida não tem ▲▼). */
export function Tri({ dir, color, size = 6 }: { dir: "up" | "down" | "flat"; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} style={{ marginRight: 3 }}>
      {dir === "up" && <Polygon points={`0,${size} ${size / 2},0 ${size},${size}`} fill={color} />}
      {dir === "down" && <Polygon points={`0,0 ${size},0 ${size / 2},${size}`} fill={color} />}
      {dir === "flat" && <Polygon points={`0,${size / 2 - 0.8} ${size},${size / 2 - 0.8} ${size},${size / 2 + 0.8} 0,${size / 2 + 0.8}`} fill={color} />}
    </Svg>
  );
}

export function DeltaText({ d, unit, betterIsLower, vsLabel }: { d: number | null; unit: "%" | "p.p."; betterIsLower?: boolean; vsLabel: string }) {
  if (d === null) return <Text style={{ fontSize: 7.5, color: C.ink3 }}>sem comparação com {vsLabel}</Text>;
  const good = d === 0 ? null : betterIsLower ? d < 0 : d > 0;
  const color = good === null ? C.ink3 : good ? C.good : C.bad;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Tri dir={d > 0 ? "up" : d < 0 ? "down" : "flat"} color={color} />
      <Text style={{ fontSize: 7.5, color }}>
        {d > 0 ? "+" : ""}
        {nf1(d)}
        {unit === "%" ? "%" : " p.p."} <Text style={{ color: C.ink3 }}>vs {vsLabel}</Text>
      </Text>
    </View>
  );
}

export function Kpi({ label, value, detail, delta, accent, width = "32%" }: { label: string; value: string; detail?: string; delta?: React.ReactNode; accent?: boolean; width?: string }) {
  return (
    <View style={{ width, marginBottom: 8, borderWidth: 1, borderColor: accent ? "#f1c9a3" : C.line, backgroundColor: accent ? C.accentSoft : "#ffffff", borderRadius: 10, padding: 10 }}>
      <Text style={{ fontSize: 7.5, fontWeight: 700, color: C.ink3, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: 800, color: C.ink, marginTop: 4, letterSpacing: -0.5 }}>{value}</Text>
      {delta && <View style={{ marginTop: 3 }}>{delta}</View>}
      {detail && <Text style={{ fontSize: 7.5, color: C.ink3, marginTop: 3 }}>{detail}</Text>}
    </View>
  );
}

/** Barras horizontais (valor em texto, barra na cor de destaque) com linha de referência opcional. */
export function HBars({ rows, max = 100, refValue, refLabel, unit = "%", labelWidth = 92, valueWidth = 70 }: { rows: { label: string; value: number | null; sub?: string }[]; max?: number; refValue?: number | null; refLabel?: string; unit?: string; labelWidth?: number; valueWidth?: number }) {
  return (
    <View>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
          <Text style={{ width: labelWidth, fontSize: 8.5, color: C.ink, fontWeight: 600 }}>{r.label}</Text>
          <View style={{ flex: 1, height: 9, backgroundColor: C.tint, borderRadius: 5, position: "relative" }}>
            {r.value !== null && <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(1.5, Math.min(100, (r.value / max) * 100))}%`, backgroundColor: C.accent, borderRadius: 5 }} />}
            {refValue != null && <View style={{ position: "absolute", top: -3, bottom: -3, left: `${Math.min(100, (refValue / max) * 100)}%`, width: 1.2, backgroundColor: C.graphite }} />}
          </View>
          <Text style={{ width: valueWidth, textAlign: "right", fontSize: 8.5, fontWeight: 700, color: C.ink }}>
            {r.value === null ? "Sem base" : `${nf1(r.value)}${unit}`}
            {r.sub ? <Text style={{ fontWeight: 400, color: C.ink3 }}> {r.sub}</Text> : null}
          </Text>
        </View>
      ))}
      {refValue != null && refLabel && (
        <Text style={{ fontSize: 7, color: C.ink3, marginTop: 1, marginLeft: labelWidth }}>
          | {refLabel}: {nf1(refValue)}
          {unit}
        </Text>
      )}
    </View>
  );
}

/** Colunas verticais (volume) com rótulos diretos. */
export function Columns({ data, height = 90 }: { data: { label: string; value: number; muted?: boolean }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: height + 28, gap: 8 }}>
      {data.map((d, i) => (
        <View key={i} style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontSize: 8, fontWeight: 700, color: C.ink, marginBottom: 3 }}>{d.value}</Text>
          <View style={{ width: "62%", height: Math.max(2, (d.value / max) * height), backgroundColor: d.muted ? "#ecd3bb" : C.accent, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
          <Text style={{ fontSize: 7.5, color: C.ink3, marginTop: 4 }}>{d.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Linhas de taxa (0–100%), duas séries no MESMO eixo, com legenda e rótulos do último ponto. */
export function RateLines({ labels, series, width = 515, height = 110 }: { labels: string[]; series: { name: string; color: string; values: (number | null)[] }[]; width?: number; height?: number }) {
  const padL = 26;
  const padB = 16;
  const w = width - padL - 10;
  const h = height - padB - 8;
  const x = (i: number) => padL + (labels.length === 1 ? w / 2 : (i * w) / (labels.length - 1));
  const y = (v: number) => 8 + h - (v / 100) * h;
  return (
    <View>
      <Svg width={width} height={height}>
        {[0, 25, 50, 75, 100].map((g) => (
          <Polyline key={g} points={`${padL},${y(g)} ${padL + w},${y(g)}`} stroke={C.line} strokeWidth={0.6} />
        ))}
        {series.map((sr) => {
          const pts = sr.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
          return (
            <G key={sr.name}>
              {pts && <Polyline points={pts} stroke={sr.color} strokeWidth={1.8} fill="none" />}
              {sr.values.map((v, i) => (v === null ? null : <Circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill={sr.color} stroke="#ffffff" strokeWidth={1} />))}
            </G>
          );
        })}
      </Svg>
      <View style={{ flexDirection: "row", position: "absolute", left: 0, top: 0, height: height, width: padL }}>
        <View style={{ flex: 1 }}>
          {[100, 75, 50, 25, 0].map((g) => (
            <Text key={g} style={{ position: "absolute", top: y(g) - 4, fontSize: 6.5, color: C.ink3 }}>
              {g}%
            </Text>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: "row", marginLeft: padL, width: w, justifyContent: "space-between", marginTop: -12 }}>
        {labels.map((l) => (
          <Text key={l} style={{ fontSize: 7.5, color: C.ink3 }}>
            {l}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 14, marginTop: 8, marginLeft: padL }}>
        {series.map((sr) => {
          const last = [...sr.values].reverse().find((v) => v !== null);
          return (
            <View key={sr.name} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 10, height: 3, backgroundColor: sr.color, borderRadius: 2 }} />
              <Text style={{ fontSize: 7.5, color: C.ink2 }}>
                {sr.name}
                {last != null ? ` · último: ${nf1(last)}%` : ""}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Table({ head, rows, widths, boldLast, textCols = 1 }: { head: string[]; rows: (string | number)[][]; widths: number[]; boldLast?: boolean; textCols?: number }) {
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 8 }}>
      <View style={{ flexDirection: "row", backgroundColor: C.tint, borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
        {head.map((h, i) => (
          <Text key={i} style={{ width: `${widths[i]}%`, padding: 6, fontSize: 7, fontWeight: 700, color: C.ink3, textTransform: "uppercase", textAlign: i < textCols ? "left" : "right" }}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => {
        const bold = boldLast && ri === rows.length - 1;
        return (
          <View key={ri} style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line, backgroundColor: bold ? "#fbfaf8" : "#ffffff" }} wrap={false}>
            {r.map((c, i) => (
              <Text key={i} style={{ width: `${widths[i]}%`, padding: 6, fontSize: 8.5, fontWeight: bold || i === 0 ? 700 : 400, textAlign: i < textCols ? "left" : "right", color: i > 0 && i < textCols ? C.ink2 : C.ink }}>
                {String(c)}
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/** Página A4 com cabeçalho (logo + título à direita) e rodapé com numeração. */
export function PdfFrame({ title, subtitle, footer, children, bookmark }: { title: string; subtitle: string; footer: string; children: React.ReactNode; bookmark?: string }) {
  return (
    <Page size="A4" style={s.page} bookmark={bookmark}>
      <View style={s.header} fixed>
        <Image src={path.join(ASSETS, "auxiliadora-logo.png")} style={{ height: 22 }} />
        <Text style={s.headerRight}>
          {title}
          {"\n"}
          <Text style={{ color: C.ink, fontWeight: 700 }}>{subtitle}</Text>
        </Text>
      </View>
      {children}
      <View style={s.footer} fixed>
        <Text>{footer}</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </Page>
  );
}
