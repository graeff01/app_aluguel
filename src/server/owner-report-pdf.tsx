/**
 * PDF do relatório do imóvel para o proprietário (A4, 1–2 páginas).
 * Sem dados pessoais: nada de nomes, telefones ou observações livres.
 */
import { Document, Image, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { C, Columns, HBars, Kpi, PdfFrame, ensureFonts, s } from "./pdf-kit";
import type { OwnerReport } from "./owner-report";

const brl = (n: number | null) => (n ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : null);
const pctN = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);

const LEVEL_COLORS: Record<string, { bg: string; fg: string }> = {
  stuck: { bg: C.badSoft, fg: C.bad },
  attention: { bg: C.accentSoft, fg: "#9a4f0c" },
  healthy: { bg: C.goodSoft, fg: C.good },
  low_data: { bg: C.tint, fg: C.ink2 },
};

function OwnerDoc({ r }: { r: OwnerReport }) {
  const p = r.property;
  const facts = [p.category, p.neighborhood && `${p.neighborhood}${p.city ? `, ${p.city}` : ""}`, p.area && `${p.area} m²`, p.bedrooms && `${p.bedrooms} ${p.bedrooms === 1 ? "quarto" : "quartos"}`].filter(Boolean).join(" · ");
  const lc = LEVEL_COLORS[p.level];
  const compare = [
    { label: "Este imóvel", value: pctN(p.positiveRate.value), sub: p.done ? `(${p.positive}/${p.done})` : undefined },
    ...(p.similar ? [{ label: "Parecidos", value: pctN(p.similar.rate.value), sub: `(${p.similar.properties} imóveis)` }] : []),
    { label: "Média da agência", value: pctN(r.agency.value) },
  ];
  const generated = r.generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return (
    <Document title={`Relatório do imóvel ${p.code}`} author="Auxiliadora Predial" language="pt-BR">
      <PdfFrame title="Relatório de visitas do imóvel" subtitle={`Imóvel ${p.code} · ${r.periodLabel}`} footer={`Dados das visitas registradas pela equipe de locação · sem dados pessoais de visitantes · gerado em ${generated}`}>
        <View style={{ flexDirection: "row", gap: 16, marginBottom: 18 }}>
          {r.photo && <Image src={r.photo} style={{ width: 170, height: 113, borderRadius: 10, objectFit: "cover" }} />}
          <View style={{ flex: 1, justifyContent: "center" }}>
            <Text style={s.eyebrow}>Imóvel {p.code}</Text>
            <Text style={{ ...s.h1, fontSize: 20 }}>{p.title ?? `Imóvel ${p.code}`}</Text>
            {facts ? <Text style={{ fontSize: 9.5, color: C.ink2, marginTop: 6 }}>{facts}</Text> : null}
            {(p.rent || p.totalPrice) && (
              <Text style={{ fontSize: 9.5, color: C.ink2, marginTop: 3 }}>
                {p.rent ? <Text style={{ color: C.ink, fontWeight: 700 }}>Aluguel {brl(p.rent)}</Text> : null}
                {p.totalPrice ? `  ·  total com encargos ${brl(p.totalPrice)}` : ""}
              </Text>
            )}
            <Text style={{ fontSize: 8.5, color: C.ink3, marginTop: 6 }}>Período: {r.periodLabel.toLowerCase()}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 10 }}>
          <Kpi width="19%" label="Visitas" value={String(p.done)} accent detail="realizadas" />
          <Kpi width="19%" label="Gostaram" value={p.done ? `${pctN(p.positiveRate.value)}%` : "—"} detail={`${p.positive} de ${p.done}`} />
          <Kpi width="19%" label="Não gostaram" value={String(p.negative)} detail={p.done ? `${Math.round((p.negative / p.done) * 100)}% das visitas` : "—"} />
          <Kpi width="19%" label="Decidindo" value={String(p.undecided)} detail="vão pensar" />
          <Kpi width="19%" label="Faltaram" value={String(p.noShow)} detail="não compareceram" />
        </View>

        <View style={{ ...s.card, backgroundColor: lc.bg, borderColor: lc.bg, marginBottom: 18 }} wrap={false}>
          <Text style={{ fontSize: 8, fontWeight: 800, color: lc.fg, letterSpacing: 1.2, textTransform: "uppercase" }}>Leitura do período · {r.levelLabel}</Text>
          {r.findings.map((f, i) => (
            <Text key={i} style={{ fontSize: 9.5, color: C.ink, marginTop: 5 }}>
              •  {f}
            </Text>
          ))}
          <Text style={{ fontSize: 10.5, fontWeight: 800, color: C.ink, marginTop: 9 }}>Recomendação: {p.suggestion}</Text>
        </View>

        <View style={{ flexDirection: "row", gap: 18 }}>
          <View style={{ flex: 1 }} wrap={false}>
            <Text style={s.h2}>Interesse comparado</Text>
            <Text style={s.hint}>% de visitantes que gostaram do imóvel</Text>
            <HBars rows={compare} labelWidth={80} valueWidth={100} />
            {p.similar && <Text style={{ fontSize: 7.5, color: C.ink3, marginTop: 4 }}>Parecidos: {p.similar.basis} — no mesmo período.</Text>}
          </View>
          <View style={{ flex: 1 }} wrap={false}>
            <Text style={s.h2}>Por que não avançou</Text>
            <Text style={s.hint}>Motivo principal de quem não gostou</Text>
            {p.reasons.length ? (
              <HBars labelWidth={100} valueWidth={62} rows={p.reasons.slice(0, 6).map((x) => ({ label: x.label, value: Math.round((x.count / Math.max(1, p.negative)) * 1000) / 10, sub: `(${x.count})` }))} />
            ) : (
              <Text style={{ fontSize: 9, color: C.ink3 }}>Nenhuma visita negativa no período.</Text>
            )}
          </View>
        </View>

        {r.months.length > 1 && (
          <View style={{ marginTop: 18 }} wrap={false}>
            <Text style={s.h2}>Visitas por mês</Text>
            <Text style={s.hint}>Visitas realizadas em cada mês do período</Text>
            <Columns data={r.months.map((m) => ({ label: m.label, value: m.visits }))} height={70} />
          </View>
        )}

        <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 }}>
          <Text style={{ fontSize: 7.5, color: C.ink3 }}>
            Como ler: “gostaram” são as visitas em que o visitante quis avançar com o imóvel; “decidindo” são visitantes que ainda vão pensar. Os motivos são escolhidos pela equipe em uma lista padronizada logo após cada
            visita. Percentuais calculados só sobre visitas realizadas; quando não há visitas, aparece “—”.
            {p.url ? ` Anúncio: ${p.url}` : ""}
          </Text>
        </View>
      </PdfFrame>
    </Document>
  );
}

export async function renderOwnerReportPdf(r: OwnerReport): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<OwnerDoc r={r} />);
}
