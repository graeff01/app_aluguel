/**
 * PDF do relatório mensal (A4). Renderizado no servidor com @react-pdf/renderer.
 * Regras visuais: cor de destaque só para dados; texto sempre em tons de tinta; sem eixo duplo;
 * comparações sempre com seta + número (nunca só cor).
 */
import { Document, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Rate } from "@/lib/metrics";
import { pctText, type Kpis, type MonthlyReport } from "./report";
import { C, Columns, DeltaText, HBars, Kpi, PdfFrame, RateLines, Table, Tri, ensureFonts, nf1, ppDelta, relDelta, s } from "./pdf-kit";

function Frame({ r, children, bookmark }: { r: MonthlyReport; children: React.ReactNode; bookmark?: string }) {
  return (
    <PdfFrame
      title="Relatório mensal de visitas de locação"
      subtitle={r.label}
      footer={`Visitas Locação · Confidencial — uso interno · gerado em ${r.generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
      bookmark={bookmark}
    >
      {children}
    </PdfFrame>
  );
}

function kpiTiles(k: Kpis, p: Kpis, prevShort: string, goal: number) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
      <Kpi label="Visitas realizadas" value={String(k.done)} accent delta={<DeltaText d={relDelta(k.done, p.done)} unit="%" vsLabel={prevShort} />} detail={`${k.scheduled} agendadas no mês`} />
      <Kpi label="Taxa de positivas" value={pctText(k.positiveRate)} delta={<DeltaText d={ppDelta(k.positiveRate, p.positiveRate)} unit="p.p." vsLabel={prevShort} />} detail={k.positiveRate.den ? `${k.positiveRate.num} de ${k.positiveRate.den} realizadas` : "sem visitas avaliadas"} />
      <Kpi label="Não comparecimento" value={pctText(k.noShowRate)} delta={<DeltaText d={ppDelta(k.noShowRate, p.noShowRate)} unit="p.p." betterIsLower vsLabel={prevShort} />} detail={`${k.noShow} não compareceram`} />
      <Kpi label="Cobertura de registro" value={pctText(k.coverage)} delta={<DeltaText d={ppDelta(k.coverage, p.coverage)} unit="p.p." vsLabel={prevShort} />} detail={`meta ${goal}% · ${k.coverage.num} de ${k.coverage.den} encerradas`} />
      <Kpi label="Locações fechadas" value={String(k.closures)} delta={<DeltaText d={relDelta(k.closures, p.closures)} unit="%" vsLabel={prevShort} />} detail="pela data do fechamento" />
      <Kpi label="Conversão da coorte" value={pctText(k.cohort)} detail={k.cohort.den ? `${k.cohort.num} de ${k.cohort.den} oportunidades · ${k.cohort.open} abertas` : "sem oportunidades iniciadas"} />
    </View>
  );
}

function ReportDoc({ r }: { r: MonthlyReport }) {
  const prevShort = r.prevLabel.split(" ")[0];
  const team = r.team;
  const consultants = r.perConsultant;
  const pctN = (x: Rate) => (x.value === null ? null : Math.round(x.value * 1000) / 10);
  return (
    <Document title={`Relatório de visitas — ${r.label}`} author="Visitas Locação" subject="Relatório mensal" language="pt-BR">
      {/* ───────── 1. Resumo executivo ───────── */}
      <Frame r={r} bookmark="Resumo executivo">
        <Text style={s.eyebrow}>Resumo executivo</Text>
        <Text style={s.h1}>Visitas de locação — {r.label}</Text>
        <Text style={{ marginTop: 4, marginBottom: 14, color: C.ink3 }}>
          Período de {r.from.split("-").reverse().join("/")} a {r.to.split("-").reverse().join("/")}
          {r.partial ? " · mês em andamento (números parciais)" : ""} · comparação com {r.prevLabel}
        </Text>
        {kpiTiles(team, r.teamPrev, prevShort, r.goal)}

        <View style={[s.card, { marginTop: 6, backgroundColor: C.tint, borderColor: C.tint }]}>
          <Text style={[s.h2, { marginBottom: 8 }]}>Destaques do mês</Text>
          {r.highlights.map((h, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 5 }} wrap={false}>
              <View style={{ width: 13, paddingTop: 2.5 }}>
                <Tri dir={h.tone === "good" ? "up" : h.tone === "bad" ? "down" : "flat"} color={h.tone === "good" ? C.good : h.tone === "bad" ? C.bad : C.ink3} size={6.5} />
              </View>
              <Text style={{ flex: 1, fontSize: 9.5, color: C.ink }}>{h.text}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          {[
            ["Canceladas", team.canceled],
            ["Remarcadas", team.rescheduled],
            ["Sem registro", team.awaiting],
            ["> 24 h sem registro", team.awaitingOver24h],
            ["Clientes atendidos", team.clients],
          ].map(([k, v]) => (
            <View key={String(k)} style={{ flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 8 }}>
              <Text style={{ fontSize: 7, color: C.ink3, fontWeight: 700, textTransform: "uppercase" }}>{k}</Text>
              <Text style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginTop: 2 }}>{String(v)}</Text>
            </View>
          ))}
        </View>
      </Frame>

      {/* ───────── 2. Comparação entre consultoras ───────── */}
      <Frame r={r} bookmark="Comparação entre consultoras">
        <Text style={s.eyebrow}>Equipe</Text>
        <Text style={[s.h1, { fontSize: 18, marginBottom: 4 }]}>Comparação entre consultoras</Text>
        <Text style={s.hint}>Visita atribuída à consultora que a realizou; fechamento, à responsável registrada no fechamento. Volume ao lado das taxas — poucas visitas não sustentam conclusões.</Text>
        <Table
          head={["Consultora", "Agend.", "Realiz.", "Positivas", "Não comp.", "Cobertura", ">24 h", "Fech.", "Var. positivas"]}
          widths={[22, 9, 9, 11, 11, 11, 8, 7, 12]}
          boldLast
          rows={[
            ...consultants.map((c) => {
              const d = ppDelta(c.kpis.positiveRate, c.prev.positiveRate);
              return [c.name, c.kpis.scheduled, c.kpis.done, pctText(c.kpis.positiveRate), pctText(c.kpis.noShowRate), pctText(c.kpis.coverage), c.kpis.awaitingOver24h, c.kpis.closures, d === null ? "—" : `${d > 0 ? "+" : ""}${nf1(d)} p.p.`];
            }),
            ["Equipe", team.scheduled, team.done, pctText(team.positiveRate), pctText(team.noShowRate), pctText(team.coverage), team.awaitingOver24h, team.closures, (() => { const d = ppDelta(team.positiveRate, r.teamPrev.positiveRate); return d === null ? "—" : `${d > 0 ? "+" : ""}${nf1(d)} p.p.`; })()],
          ]}
        />
        <View style={{ flexDirection: "row", gap: 16, marginTop: 18 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.h2}>Taxa de positivas</Text>
            <Text style={s.hint}>Positivas ÷ realizadas avaliadas. Linha = média da equipe.</Text>
            <HBars rows={consultants.map((c) => ({ label: c.name.split(" ")[0], value: pctN(c.kpis.positiveRate), sub: c.kpis.positiveRate.den ? `(${c.kpis.positiveRate.num}/${c.kpis.positiveRate.den})` : undefined }))} refValue={pctN(team.positiveRate)} refLabel="Equipe" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.h2}>Cobertura de registro</Text>
            <Text style={s.hint}>Encerradas com resultado ÷ encerradas. Linha = meta.</Text>
            <HBars rows={consultants.map((c) => ({ label: c.name.split(" ")[0], value: pctN(c.kpis.coverage) }))} refValue={r.goal} refLabel="Meta" />
          </View>
        </View>
        <View style={{ marginTop: 14 }}>
          <Text style={s.h2}>Visitas realizadas no mês</Text>
          <Columns data={consultants.map((c) => ({ label: c.name.split(" ")[0], value: c.kpis.done }))} height={70} />
        </View>
      </Frame>

      {/* ───────── 3. Evolução ───────── */}
      <Frame r={r} bookmark="Evolução de 6 meses">
        <Text style={s.eyebrow}>Tendência</Text>
        <Text style={[s.h1, { fontSize: 18, marginBottom: 10 }]}>Evolução dos últimos 6 meses</Text>
        <Text style={s.h2}>Visitas realizadas</Text>
        <Columns data={r.series.map((m, i) => ({ label: m.label, value: m.done, muted: i < r.series.length - 1 }))} />
        <View style={{ marginTop: 14 }}>
          <Text style={s.h2}>Taxas mensais</Text>
          <Text style={s.hint}>Mesmo eixo (0–100%). Pontos ausentes = sem base no mês.</Text>
          <RateLines
            labels={r.series.map((m) => m.label)}
            series={[
              { name: "Positivas", color: C.accent, values: r.series.map((m) => pctN(m.positiveRate)) },
              { name: "Cobertura", color: C.graphite, values: r.series.map((m) => pctN(m.coverage)) },
              { name: "Não comparecimento", color: C.blue, values: r.series.map((m) => pctN(m.noShowRate)) },
            ]}
          />
        </View>
        <View style={{ marginTop: 14 }}>
          <Table
            head={["Mês", "Agendadas", "Realizadas", "Positivas", "Não comp.", "Cobertura", "Fechamentos"]}
            widths={[16, 14, 14, 14, 14, 14, 14]}
            rows={r.series.map((m) => [m.label, m.scheduled, m.done, pctText(m.positiveRate), pctText(m.noShowRate), pctText(m.coverage), m.closures])}
          />
        </View>
      </Frame>

      {/* ───────── 4. Funil e motivos ───────── */}
      <Frame r={r} bookmark="Funil e motivos">
        <Text style={s.eyebrow}>Conversão</Text>
        <Text style={[s.h1, { fontSize: 18, marginBottom: 4 }]}>Funil de locação e motivos</Text>
        <Text style={s.hint}>Oportunidades cliente–imóvel com 1ª visita realizada no mês, acompanhadas até a data deste relatório.</Text>
        <View style={s.card}>
          {r.funnel.steps.map((st, i) => {
            const base = r.funnel.steps[0].count || 1;
            const prev = i ? r.funnel.steps[i - 1].count : null;
            return (
              <View key={st.key} style={{ marginBottom: 8 }} wrap={false}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                  <Text style={{ fontSize: 9, fontWeight: 700, color: C.ink }}>
                    {st.label} <Text style={{ fontWeight: 400, color: C.ink3 }}>· {st.hint}</Text>
                  </Text>
                  <Text style={{ fontSize: 9, color: C.ink3 }}>
                    <Text style={{ fontWeight: 800, color: C.ink }}>{st.count}</Text>
                    {prev ? ` · ${Math.round((st.count / prev) * 100)}% da etapa anterior` : ""}
                  </Text>
                </View>
                <View style={{ height: 10, backgroundColor: C.tint, borderRadius: 5 }}>
                  <View style={{ height: 10, width: `${Math.max(st.count ? 2 : 0, (st.count / base) * 100)}%`, backgroundColor: C.accent, opacity: 1 - i * 0.15, borderRadius: 5 }} />
                </View>
              </View>
            );
          })}
          <Text style={{ fontSize: 8, color: C.ink3, marginTop: 2 }}>
            Tempo médio até documentação: {r.funnel.daysToDocs ?? "—"} dias · até fechar: {r.funnel.daysToClose ?? "—"} dias · ainda abertas: {r.funnel.open}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 16, marginTop: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.h2}>Motivos das visitas negativas</Text>
            <Text style={s.hint}>{r.evaluations.negative} negativas no mês · % das negativas</Text>
            {r.negativeReasons.length ? <HBars rows={r.negativeReasons.map((x) => ({ label: x.label.length > 18 ? x.label.slice(0, 17) + "…" : x.label, value: x.share.value === null ? null : x.share.value * 100, sub: `(${x.count})` }))} /> : <Text style={{ color: C.ink3 }}>Sem visitas negativas.</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.h2}>Motivos de perda posterior</Text>
            <Text style={s.hint}>Oportunidades perdidas após a visita · % das perdas</Text>
            {r.lostReasons.length ? <HBars rows={r.lostReasons.map((x) => ({ label: x.label.length > 18 ? x.label.slice(0, 17) + "…" : x.label, value: x.share.value === null ? null : x.share.value * 100, sub: `(${x.count})` }))} /> : <Text style={{ color: C.ink3 }}>Sem perdas posteriores registradas.</Text>}
          </View>
        </View>
      </Frame>

      {/* ───────── 5. Imóveis, qualidade e metodologia ───────── */}
      <Frame r={r} bookmark="Imóveis e metodologia">
        <Text style={s.eyebrow}>Imóveis</Text>
        <Text style={[s.h1, { fontSize: 18, marginBottom: 8 }]}>Imóveis mais visitados</Text>
        {r.topProperties.length ? (
          <Table
            head={["Imóvel", "Anúncio", "Visitas", "Realiz.", "Positivas", "Negativas"]}
            widths={[11, 45, 10, 10, 12, 12]}
            textCols={2}
            rows={r.topProperties.map((p) => [p.key, (p.title ?? "—").replace(/ para alugar em /, " · ").slice(0, 62), p.total, p.done, pctText(p.positiveRate), p.negative])}
          />
        ) : (
          <Text style={{ color: C.ink3 }}>Sem visitas no mês.</Text>
        )}
        {r.mostRejected.length > 0 && (
          <View style={{ marginTop: 12 }} wrap={false}>
            <Text style={s.h2}>Mais recusas no mês</Text>
            {r.mostRejected.map((p) => (
              <Text key={p.key} style={{ fontSize: 8.5, color: C.ink, marginBottom: 2 }}>
                • {p.key} — {p.negative} negativa{p.negative > 1 ? "s" : ""} em {p.done} realizada{p.done === 1 ? "" : "s"}
                {p.title ? <Text style={{ color: C.ink3 }}> · {p.title.replace(/ para alugar em /, " · ").slice(0, 70)}</Text> : null}
              </Text>
            ))}
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 16, marginTop: 16 }} wrap={false}>
          <View style={[s.card, { flex: 1 }]}>
            <Text style={s.h2}>Qualidade dos dados</Text>
            {[
              ["Visitas no mês", String(r.quality.total)],
              ["Com telefone validado", pctText(r.quality.withPhone)],
              ["Com código do imóvel", pctText(r.quality.withCode)],
              ["Vindas da agenda", pctText(r.quality.fromCalendar)],
              ["Clientes com identificação pendente", String(r.quality.pendingIdentity)],
            ].map(([k, v]) => (
              <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.6, borderBottomColor: C.line }}>
                <Text>{k}</Text>
                <Text style={{ fontWeight: 700, color: C.ink }}>{v}</Text>
              </View>
            ))}
          </View>
          <View style={[s.card, { flex: 1.3 }]}>
            <Text style={s.h2}>Como ler os números</Text>
            {[
              "Os números começam nas visitas registradas — não representam todos os contatos da imobiliária.",
              "Período de visitas: data da visita (horário de Brasília). Fechamentos: data do fechamento, uma vez por oportunidade.",
              "Positiva = interesse em avançar, não contrato fechado.",
              "Não comparecimento = não compareceu ÷ (realizadas + não compareceu).",
              "Cobertura = encerradas com resultado ÷ encerradas (desde o início da cobrança).",
              "Conversão da coorte = oportunidades do mês que chegaram a locação fechada até hoje.",
              "“Sem base” = não há registros para calcular (não é 0%).",
            ].map((t) => (
              <Text key={t} style={{ fontSize: 7.8, marginBottom: 3 }}>
                • {t}
              </Text>
            ))}
          </View>
        </View>
      </Frame>

      {/* ───────── 6. Fichas individuais ───────── */}
      {consultants.map((c) => {
        const k = c.kpis;
        const vsTeam = (mine: Rate, t: Rate, lower?: boolean) => {
          const d = ppDelta(mine, t);
          if (d === null) return <Text style={{ fontSize: 7.5, color: C.ink3 }}>equipe: {pctText(t)}</Text>;
          const good = d === 0 ? null : lower ? d < 0 : d > 0;
          const col = good === null ? C.ink3 : good ? C.good : C.bad;
          return (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Tri dir={d > 0 ? "up" : d < 0 ? "down" : "flat"} color={col} />
              <Text style={{ fontSize: 7.5, color: col }}>
                {d > 0 ? "+" : ""}
                {nf1(d)} p.p. <Text style={{ color: C.ink3 }}>vs equipe ({pctText(t)})</Text>
              </Text>
            </View>
          );
        };
        return (
          <Frame key={c.id} r={r} bookmark={`Ficha: ${c.name}`}>
            <Text style={s.eyebrow}>Ficha individual</Text>
            <Text style={[s.h1, { fontSize: 20 }]}>{c.name}</Text>
            <Text style={{ marginTop: 3, marginBottom: 12, color: C.ink3 }}>
              {k.scheduled} agendadas · {k.done} realizadas · {k.canceled} canceladas · {k.rescheduled} remarcadas{c.active ? "" : " · usuária inativa"}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
              <Kpi label="Visitas realizadas" value={String(k.done)} accent delta={<DeltaText d={relDelta(k.done, c.prev.done)} unit="%" vsLabel={prevShort} />} />
              <Kpi label="Taxa de positivas" value={pctText(k.positiveRate)} delta={vsTeam(k.positiveRate, team.positiveRate)} detail={k.positiveRate.den ? `${k.positiveRate.num} de ${k.positiveRate.den}` : undefined} />
              <Kpi label="Não comparecimento" value={pctText(k.noShowRate)} delta={vsTeam(k.noShowRate, team.noShowRate, true)} />
              <Kpi label="Cobertura de registro" value={pctText(k.coverage)} delta={vsTeam(k.coverage, team.coverage)} detail={`meta ${r.goal}%`} />
              <Kpi label="Locações fechadas" value={String(k.closures)} detail={`equipe: ${team.closures}`} />
              <Kpi label="Sem registro > 24 h" value={String(k.awaitingOver24h)} detail={`${k.awaiting} aguardando no total`} />
            </View>
            <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
              <View style={{ flex: 1.2 }}>
                <Text style={s.h2}>Realizadas por mês</Text>
                <Columns data={c.series.map((m, i) => ({ label: m.label, value: m.done, muted: i < c.series.length - 1 }))} height={64} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.h2}>Motivos de recusa</Text>
                {c.negativeReasons.length ? (
                  <HBars rows={c.negativeReasons.map((x) => ({ label: x.label.length > 16 ? x.label.slice(0, 15) + "…" : x.label, value: x.share.value === null ? null : x.share.value * 100, sub: `(${x.count})` }))} />
                ) : (
                  <Text style={{ color: C.ink3 }}>Sem visitas negativas no mês.</Text>
                )}
              </View>
            </View>
            <View style={{ marginTop: 10 }}>
              <Text style={s.h2}>Taxas mensais</Text>
              <RateLines
                labels={c.series.map((m) => m.label)}
                height={96}
                series={[
                  { name: "Positivas", color: C.accent, values: c.series.map((m) => pctN(m.positiveRate)) },
                  { name: "Cobertura", color: C.graphite, values: c.series.map((m) => pctN(m.coverage)) },
                ]}
              />
            </View>
          </Frame>
        );
      })}
    </Document>
  );
}

export async function renderMonthlyReportPdf(r: MonthlyReport): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<ReportDoc r={r} />);
}
