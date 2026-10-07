import Link from "next/link";
import { requireManager } from "@/lib/require";
import { dashboard } from "@/server/queries";
import { addDays, dayKey, fmt } from "@/lib/time";
import { formatRate } from "@/lib/metrics";
import { Avatar, Field, Input, PageHeader, Section, Segmented, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { BarList, Delta, RateValue, StatTile, VsTeam, rateDetail } from "@/components/stats";
import { SyncButton } from "@/components/sync-button";

export const metadata = { title: "Painel" };

function presets(now: Date) {
  const t = dayKey(now);
  const firstThis = t.slice(0, 8) + "01";
  const lastPrev = addDays(firstThis, -1);
  return [
    { label: "Este mês", from: firstThis, to: t },
    { label: "Mês passado", from: lastPrev.slice(0, 8) + "01", to: lastPrev },
    { label: "7 dias", from: addDays(t, -6), to: t },
    { label: "30 dias", from: addDays(t, -29), to: t },
  ];
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireManager();
  const sp = await searchParams;
  const now = new Date();
  const d = await dashboard(actor, { from: sp.de, to: sp.ate, consultantId: sp.consultora, propertyCode: sp.imovel }, now);
  const m = d.metrics;
  const team = d.team;
  const firstNames = d.perConsultant.map((c) => c.user.name.split(" ")[0]);
  const shortName = (name: string) => {
    const first = name.split(" ")[0];
    return firstNames.filter((f) => f === first).length > 1 ? name.replace(/\s*\(.*?\)/, "") : first;
  };
  const individual = d.perConsultant.find((c) => c.user.id === d.consultantId)?.user ?? null;
  const reasonName = new Map(d.reasons.map((r) => [r.id, r.label]));

  const q = (over: Record<string, string | null>) => {
    const p = new URLSearchParams({ de: d.from, ate: d.to });
    if (d.consultantId) p.set("consultora", d.consultantId);
    if (d.propertyCode) p.set("imovel", d.propertyCode);
    for (const [k, v] of Object.entries(over)) v === null ? p.delete(k) : p.set(k, v);
    return `?${p}`;
  };
  const hist = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ de: d.from, ate: d.to, ...(d.consultantId ? { consultora: d.consultantId } : {}), ...extra });
    return `/historico?${p}`;
  };

  return (
    <>
      <PageHeader
        eyebrow={`${fmt.dayKey(d.from)} — ${fmt.dayKey(d.to)}`}
        title={individual ? individual.name : "Painel da equipe"}
        subtitle={individual ? "Visão individual, comparada com a equipe no mesmo período" : "Visitas pela data da visita · fechamentos pela data do fechamento"}
        action={<SyncButton />}
      />

      {/* Quem: equipe ou consultora */}
      <div className="mb-4">
        <Segmented
          label="Visão"
          items={[
            { href: q({ consultora: null }), label: "Equipe", active: !d.consultantId },
            ...d.perConsultant.map((c) => ({
              href: q({ consultora: c.user.id }),
              label: (
                <>
                  <Avatar name={c.user.name} size="sm" tone={d.consultantId === c.user.id ? "accent" : "light"} />
                  {shortName(c.user.name)}
                </>
              ),
              active: d.consultantId === c.user.id,
            })),
          ]}
        />
      </div>

      {/* Quando + imóvel */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Segmented label="Período" items={presets(now).map((p) => ({ href: q({ de: p.from, ate: p.to }), label: p.label, active: p.from === d.from && p.to === d.to }))} />
        <details className="group">
          <summary className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink-2 shadow-card hover:text-ink">
            <Icon name="settings" className="size-4" /> Personalizar
          </summary>
          <form className="mt-3 grid gap-x-3 rounded-3xl border border-line bg-surface p-5 shadow-card sm:grid-cols-4">
            {d.consultantId && <input type="hidden" name="consultora" value={d.consultantId} />}
            <Field label="De" htmlFor="de">
              <Input id="de" name="de" type="date" defaultValue={d.from} />
            </Field>
            <Field label="Até" htmlFor="ate">
              <Input id="ate" name="ate" type="date" defaultValue={d.to} />
            </Field>
            <Field label="Código do imóvel" htmlFor="imovel">
              <Input id="imovel" name="imovel" defaultValue={d.propertyCode ?? ""} />
            </Field>
            <div className="flex items-start pt-[26px]">
              <button className="min-h-12 w-full rounded-full bg-primary px-6 font-semibold text-white">Aplicar</button>
            </div>
          </form>
        </details>
        {d.propertyCode && (
          <Link href={q({ imovel: null })} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-accent-soft px-4 text-sm font-semibold text-accent-strong">
            Imóvel {d.propertyCode} ✕
          </Link>
        )}
      </div>

      {/* Destaques */}
      <div className="mb-10 grid gap-4 lg:grid-cols-3">
        <StatTile
          size="lg"
          label="Visitas realizadas"
          value={m.totals.done}
          detail={<Delta now={m.totals.done} before={d.previous.totals.done} />}
          href={hist({ situacao: "DONE" })}
        />
        <StatTile
          size="lg"
          label="Taxa de positivas"
          value={<RateValue r={m.positiveRate} />}
          compare={individual ? <VsTeam mine={m.positiveRate} team={team.positiveRate} /> : undefined}
          detail={
            <>
              {rateDetail(m.positiveRate, "realizadas avaliadas")}
              {m.totals.awaiting ? ` · ${m.totals.awaiting} sem registro` : ""}
            </>
          }
          href={hist({ situacao: "POSITIVE" })}
        />
        <StatTile
          size="lg"
          label="Aguardando registro"
          tone={m.totals.awaiting ? "accent" : undefined}
          value={m.totals.awaiting}
          detail={`${m.totals.awaitingOver24h} há mais de 24 h`}
          href={individual ? hist({ situacao: "SCHEDULED" }) : "/pendencias"}
        />
      </div>

      <Section title="Visitas no período">
        <dl className="grid grid-cols-3 divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card max-lg:divide-y lg:grid-cols-6 lg:divide-x">
          {[
            { k: "Agendadas", v: m.totals.scheduled, href: hist({}), sub: <Delta now={m.totals.scheduled} before={d.previous.totals.scheduled} /> },
            { k: "Realizadas", v: m.totals.done, href: hist({ situacao: "DONE" }) },
            { k: "Não compareceu", v: m.totals.noShow, href: hist({ situacao: "NO_SHOW" }) },
            { k: "Canceladas", v: m.totals.canceled, href: hist({ situacao: "CANCELED" }) },
            { k: "Remarcadas", v: m.totals.rescheduled, href: hist({ situacao: "RESCHEDULED" }) },
            { k: "Futuras", v: m.totals.upcoming },
          ].map((it) => {
            const body = (
              <>
                <dt className="text-[12px] font-semibold text-ink-3">{it.k}</dt>
                <dd className="num mt-1 text-[26px] leading-none font-bold">{it.v}</dd>
              </>
            );
            return it.href ? (
              <Link key={it.k} href={it.href} className="block px-4 py-4 transition-colors hover:bg-surface-2">
                {body}
              </Link>
            ) : (
              <div key={it.k} className="px-4 py-4">
                {body}
              </div>
            );
          })}
        </dl>
      </Section>

      <Section title="Qualidade do registro e resultados">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Não comparecimento"
            value={<RateValue r={m.noShowRate} />}
            compare={individual ? <VsTeam mine={m.noShowRate} team={team.noShowRate} higherIsBetter={false} /> : undefined}
            detail={rateDetail(m.noShowRate, "(realizadas + não compareceu)")}
          />
          <StatTile
            label="Cobertura de registro"
            value={<RateValue r={m.coverage} />}
            compare={individual ? <VsTeam mine={m.coverage} team={team.coverage} /> : undefined}
            detail={`${m.coverage.num} de ${m.coverage.den} encerradas · ${m.coverage.rescheduled} remarcadas`}
          />
          <StatTile label="Clientes distintos" value={m.clients.confirmed} detail={`${m.clients.pending} com identificação pendente`} href="/clientes?identidade=PENDING" />
          <StatTile
            label="Conversão da coorte"
            value={<RateValue r={m.cohort} />}
            compare={individual ? <VsTeam mine={m.cohort} team={team.cohort} /> : undefined}
            detail={m.cohort.den ? `${m.cohort.num} de ${m.cohort.den} oportunidades · ${m.cohort.open} abertas` : "sem oportunidades iniciadas no período"}
          />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <BarList
            total={m.evaluations.evaluated}
            rows={[
              { label: "Positiva", value: m.evaluations.positive, href: hist({ situacao: "POSITIVE" }) },
              { label: "Ainda decidindo", value: m.evaluations.undecided, href: hist({ situacao: "UNDECIDED" }) },
              { label: "Negativa", value: m.evaluations.negative, href: hist({ situacao: "NEGATIVE" }) },
            ]}
            empty="Nenhuma visita realizada no período."
          />
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Fechamentos" value={m.closures.count} detail="pela data do fechamento" href="/oportunidades?situacao=CLOSED_WON" />
            <StatTile label="Acompanhamento" value={m.openOpportunities.followUp} href="/oportunidades?situacao=FOLLOW_UP" />
            <StatTile label="Documentação" value={m.openOpportunities.docsReview} href="/oportunidades?situacao=DOCS_REVIEW" />
          </div>
        </div>
      </Section>

      {/* Equipe: uma ficha por consultora (visão geral → individual) */}
      {!individual && d.perConsultant.length > 0 && (
        <Section title="Consultoras" hint="Toque em uma consultora para ver a visão individual">
          <div className="grid gap-4 md:grid-cols-2">
            {d.perConsultant.map(({ user, metrics: cm }) => (
              <Link key={user.id} href={q({ consultora: user.id })} className="group rounded-3xl border border-line bg-surface p-5 shadow-card transition-shadow hover:shadow-float">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={user.name} size="md" />
                    <div>
                      <p className="font-bold tracking-[-0.01em]">{user.name}</p>
                      <p className="text-[13px] text-ink-3">
                        {cm.totals.scheduled} agendadas · {cm.totals.done} realizadas
                      </p>
                    </div>
                  </div>
                  <Icon name="arrow" className="size-5 text-ink-3 transition-transform group-hover:translate-x-0.5" />
                </div>
                <dl className="grid grid-cols-4 gap-2 border-t border-line pt-4">
                  {[
                    ["Positivas", formatRate(cm.positiveRate), cm.positiveRate.den ? `${cm.positiveRate.num}/${cm.positiveRate.den}` : ""],
                    ["Não comp.", formatRate(cm.noShowRate), cm.noShowRate.den ? `${cm.noShowRate.num}/${cm.noShowRate.den}` : ""],
                    ["Pendentes", String(cm.totals.awaiting), cm.totals.awaitingOver24h ? `${cm.totals.awaitingOver24h} > 24 h` : ""],
                    ["Fechamentos", String(cm.closures.count), ""],
                  ].map(([k, v, sub]) => (
                    <div key={k}>
                      <dt className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{k}</dt>
                      <dd className={cx("num mt-1 font-bold", v === "Sem base" ? "text-[13px] text-ink-3" : "text-[20px]", k === "Pendentes" && v !== "0" && "text-accent-strong")}>{v}</dd>
                      {sub && <dd className="num text-[11px] text-ink-3">{sub}</dd>}
                    </div>
                  ))}
                </dl>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-x-6 lg:grid-cols-2">
        <Section title="Motivos das visitas negativas">
          <BarList total={m.evaluations.negative} rows={m.negativeReasons.map((r) => ({ label: reasonName.get(r.reasonId) ?? "Sem motivo", value: r.count }))} empty="Nenhuma visita negativa no período." />
        </Section>
        <Section title="Motivos de perda posterior">
          <BarList total={m.lostReasons.reduce((a, r) => a + r.count, 0)} rows={m.lostReasons.map((r) => ({ label: reasonName.get(r.reasonId) ?? "Sem motivo", value: r.count }))} empty="Nenhuma perda posterior registrada no período." />
        </Section>
      </div>

      <Section title="Por imóvel" hint="Volume ao lado das taxas — poucas visitas não sustentam conclusões">
        <PropertyTable rows={m.byProperty.slice(0, 20)} link={(k) => (k === "—" ? hist({}) : q({ imovel: k }))} />
        {m.byProperty.length > 20 && <p className="mt-2 text-sm text-ink-3">Mostrando os 20 imóveis com mais visitas. Use “Personalizar” para filtrar um código.</p>}
      </Section>

      <details className="mb-8 rounded-3xl border border-line bg-surface p-5 shadow-card">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between font-semibold">
          Como os indicadores são calculados <span aria-hidden className="text-ink-3">+</span>
        </summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
          <li>Os números começam nas visitas registradas no app — não representam todos os contatos/leads da imobiliária.</li>
          <li>Período de visitas: data da visita no horário de Brasília. Visitas excluídas pela gestão não entram.</li>
          <li>Na visão individual, a visita conta para a consultora responsável quando foi realizada; o fechamento, para a responsável registrada no fechamento. “vs equipe” compara com a equipe toda no mesmo período, em pontos percentuais.</li>
          <li>Taxa de positivas = positivas ÷ realizadas com avaliação. Visitas sem registro aparecem à parte e não entram no cálculo.</li>
          <li>Não comparecimento = não compareceu ÷ (realizadas + não compareceu). Canceladas, remarcadas e pendentes ficam fora.</li>
          <li>Cobertura = compromissos encerrados com conclusão ÷ compromissos encerrados, desde a data de início da cobrança. Remarcada conta como conclusão registrada; cancelamento vindo da agenda também.</li>
          <li>“Positiva” significa interesse em avançar, não contrato fechado.</li>
          <li>Conversão da coorte = oportunidades com 1ª visita realizada no período que chegaram a locação fechada até hoje ÷ total dessas oportunidades.</li>
          <li>“Sem base” indica que não há registros para calcular a taxa (não é 0%).</li>
        </ul>
      </details>
    </>
  );
}

type Row = { key: string; total: number; done: number; noShow: number; pending: number; positive: number; negative: number; undecided: number; positiveRate: { num: number; den: number; value: number | null } };

function PropertyTable({ rows, link }: { rows: Row[]; link: (k: string) => string }) {
  if (rows.length === 0) return <p className="rounded-3xl border border-dashed border-line-strong bg-surface-2 p-5 text-sm text-ink-3">Sem registros no período.</p>;
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.key}>
            <Link href={link(r.key)} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
              <span>
                <span className="num block font-bold">{r.key === "—" ? "Sem código" : r.key}</span>
                <span className="text-[13px] text-ink-3">
                  {r.total} agendadas · {r.done} realizadas · {r.pending} pendentes
                </span>
              </span>
              <span className="num text-right text-[15px] font-bold">
                {formatRate(r.positiveRate)}
                <span className="block text-[11px] font-medium text-ink-3">positivas</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-hidden rounded-3xl border border-line bg-surface shadow-card md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-[12px] font-semibold tracking-wide text-ink-3 uppercase">
            <tr>
              <th className="px-5 py-3.5">Imóvel</th>
              {["Agendadas", "Realizadas", "Positivas", "Negativas", "Decidindo", "Taxa positivas", "Não comp.", "Pendentes"].map((h) => (
                <th key={h} className="px-3 py-3.5 text-right">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.key} className="hover:bg-surface-2">
                <td className="px-5 py-3">
                  <Link href={link(r.key)} className="font-bold hover:underline">
                    {r.key === "—" ? "Sem código" : r.key}
                  </Link>
                </td>
                <td className="px-3 py-3 text-right">{r.total}</td>
                <td className="px-3 py-3 text-right">{r.done}</td>
                <td className="px-3 py-3 text-right">{r.positive}</td>
                <td className="px-3 py-3 text-right">{r.negative}</td>
                <td className="px-3 py-3 text-right">{r.undecided}</td>
                <td className="px-3 py-3 text-right font-semibold">{formatRate(r.positiveRate)}</td>
                <td className="px-3 py-3 text-right">{r.noShow}</td>
                <td className={cx("px-3 py-3 text-right", r.pending > 0 && "font-semibold text-accent-strong")}>{r.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
