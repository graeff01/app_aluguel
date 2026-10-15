import Link from "next/link";
import { requireManager } from "@/lib/require";
import { db } from "@/lib/db";
import { preAnalysisStats } from "@/server/pre-analysis";
import { INCOME_BAND_LABEL, PRE_STATUS_LABEL } from "@/lib/labels";
import { dayKey, fmt, startOfDayInTz } from "@/lib/time";
import { PageHeader, Section, Select, cx } from "@/components/ui";
import { StatTile } from "@/components/stats";

export const metadata = { title: "Pré-atendimento" };

const STATUS_CLS: Record<string, string> = {
  AWAITING: "bg-accent-soft text-accent-strong",
  PENDING: "bg-tint text-ink-2",
  APPROVED: "bg-good-soft text-good",
  REJECTED: "bg-bad-soft text-bad",
};

type Counts = { total: number; approved: number; rejected: number; pending: number; awaiting: number };
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const monthLabel = (k: string) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${k}-15T12:00:00Z`));
const nextMonth = (k: string) => {
  const [y, m] = k.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** Gestão: acompanha o que o pré-atendimento envia e o que é aprovado, por mês. */
export default async function PreServicePanel({ searchParams }: { searchParams: Promise<{ mes?: string; de?: string }> }) {
  const actor = await requireManager();
  const sp = await searchParams;
  const current = dayKey(new Date()).slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.mes ?? "") && sp.mes! <= current ? sp.mes! : current;
  const months: string[] = [];
  for (let k = current, i = 0; i < 12; i++) {
    months.push(k);
    const [y, m] = k.split("-").map(Number);
    k = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  }
  const senders = await db.user.findMany({ where: { OR: [{ role: "PRE_SERVICE" }, { preAnalysesCreated: { some: {} } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const senderId = senders.some((u) => u.id === sp.de) ? sp.de : undefined;
  const s = await preAnalysisStats(actor, startOfDayInTz(`${month}-01`), startOfDayInTz(`${nextMonth(month)}-01`), { senderId });
  const decided = s.approved + s.rejected;
  const weekMax = Math.max(1, ...s.byWeek.map(([, c]) => c.total));

  return (
    <>
      <PageHeader title="Pré-atendimento" subtitle="Quantas pré-análises foram enviadas, para quem, com qual garantia e quantas foram aprovadas." />

      <form className="mb-7 flex flex-wrap items-end gap-3" action="/pre-analises/painel">
        <label className="text-[13px] font-semibold text-ink-2">
          Mês
          <Select name="mes" defaultValue={month} className="mt-1 min-w-44">
            {months.map((k) => (
              <option key={k} value={k}>
                {monthLabel(k)}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-[13px] font-semibold text-ink-2">
          Enviadas por
          <Select name="de" defaultValue={senderId ?? ""} className="mt-1 min-w-44">
            <option value="">Todas as pessoas</option>
            {senders.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </label>
        <button className="press min-h-12 rounded-full bg-primary px-5 text-[14px] font-semibold text-on-primary">Ver</button>
      </form>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatTile label="Enviadas" value={s.total} detail={`${s.awaiting} aguardando resposta`} />
        <StatTile label="Aprovadas" value={s.approved} detail={`taxa ${pct(s.approved, decided)} das decididas`} />
        <StatTile label="Reprovadas" value={s.rejected} detail={`${pct(s.rejected, decided)} das decididas`} />
        <StatTile label="Pendentes" value={s.pending} detail="faltando documento ou informação" />
        <StatTile label="Tempo de resposta" value={s.avgResponseHours === null ? "—" : `${s.avgResponseHours < 10 ? s.avgResponseHours.toFixed(1).replace(".", ",") : Math.round(s.avgResponseHours)} h`} detail="média da consultora" />
        <StatTile label="Viraram locação" value={s.leased} detail={`${s.withVisit} com visita · ${s.visited} visitaram`} tone="accent" />
      </div>

      {s.total === 0 ? (
        <p className="rounded-3xl border border-dashed border-line-strong px-5 py-8 text-center text-ink-3">Nenhuma pré-análise em {monthLabel(month)}.</p>
      ) : (
        <>
          <Section title="Por semana" hint="Enviadas na semana (começando na segunda) e o resultado delas.">
            <ul className="space-y-2 rounded-3xl border border-line bg-surface p-5 shadow-card">
              {s.byWeek.map(([week, c]) => (
                <li key={week} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-[13px]">
                  <span className="num text-ink-2">{week.slice(8, 10)}/{week.slice(5, 7)}</span>
                  <span className="flex h-6 overflow-hidden rounded-full bg-tint" style={{ width: `${(c.total / weekMax) * 100}%`, minWidth: "1.5rem" }} aria-hidden>
                    <span className="bg-good" style={{ width: `${(c.approved / c.total) * 100}%` }} />
                    <span className="bg-bad" style={{ width: `${(c.rejected / c.total) * 100}%` }} />
                    <span className="bg-line-strong" style={{ width: `${((c.pending + c.awaiting) / c.total) * 100}%` }} />
                  </span>
                  <span className="num font-semibold">
                    {c.total} <span className="font-normal text-ink-3">· {c.approved} aprov.</span>
                  </span>
                </li>
              ))}
              <li className="flex flex-wrap gap-4 pt-2 text-[12px] text-ink-3">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-good" /> aprovadas</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-bad" /> reprovadas</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-line-strong" /> pendentes ou aguardando</span>
              </li>
            </ul>
          </Section>

          <div className="grid gap-x-6 lg:grid-cols-2">
            <Breakdown title="Por garantia" rows={s.byGuarantee} />
            <Breakdown title="Por consultora" rows={s.byConsultant} />
            <Breakdown title="Por faixa de renda" rows={s.byIncome.map(([k, c]) => [INCOME_BAND_LABEL[k] ?? k, c] as [string, Counts])} />
            {!senderId && senders.length > 1 && <Breakdown title="Por quem enviou" rows={s.bySender} />}
          </div>

          <Section title={`Pré-análises de ${monthLabel(month)}`}>
            <div className="overflow-x-auto rounded-3xl border border-line bg-surface shadow-card">
              <table className="w-full min-w-[720px] text-left text-[14px]">
                <thead className="border-b border-line text-[12px] tracking-wide text-ink-3 uppercase">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Enviada</th>
                    <th className="px-4 py-3 font-semibold">Titular</th>
                    <th className="px-4 py-3 font-semibold">Garantia</th>
                    <th className="px-4 py-3 font-semibold">Consultora</th>
                    <th className="px-4 py-3 font-semibold">Resultado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="num px-4 py-3 whitespace-nowrap text-ink-2">{fmt.shortDate(r.createdAt)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/pre-analises/${r.id}`} className="font-semibold underline-offset-4 hover:underline">
                          {r.fullName}
                        </Link>
                        {r.propertyCode && <span className="num block text-[12px] text-ink-3">imóvel {r.propertyCode}</span>}
                      </td>
                      <td className="px-4 py-3">{r.guarantee?.label ?? <span className="text-ink-3">—</span>}</td>
                      <td className="px-4 py-3">{r.consultant.name}</td>
                      <td className="px-4 py-3">
                        <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-bold", STATUS_CLS[r.status])}>{PRE_STATUS_LABEL[r.status]}</span>
                        {r.resultNote && <span className="mt-1 block max-w-xs text-[12px] text-ink-3">{r.resultNote}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

function Breakdown({ title, rows }: { title: string; rows: [string, Counts][] }) {
  return (
    <Section title={title}>
      <div className="overflow-x-auto rounded-3xl border border-line bg-surface shadow-card">
        <table className="w-full text-left text-[14px]">
          <thead className="border-b border-line text-[12px] tracking-wide text-ink-3 uppercase">
            <tr>
              <th className="px-4 py-2.5 font-semibold" />
              <th className="px-3 py-2.5 text-right font-semibold">Enviadas</th>
              <th className="px-3 py-2.5 text-right font-semibold">Aprov.</th>
              <th className="px-3 py-2.5 text-right font-semibold">Reprov.</th>
              <th className="px-3 py-2.5 text-right font-semibold">Em aberto</th>
              <th className="px-4 py-2.5 text-right font-semibold">Taxa</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-line">
            {rows.map(([k, c]) => (
              <tr key={k}>
                <td className="px-4 py-2.5 font-medium">{k}</td>
                <td className="px-3 py-2.5 text-right">{c.total}</td>
                <td className="px-3 py-2.5 text-right text-good">{c.approved}</td>
                <td className="px-3 py-2.5 text-right text-bad">{c.rejected}</td>
                <td className="px-3 py-2.5 text-right text-ink-2">{c.pending + c.awaiting}</td>
                <td className="px-4 py-2.5 text-right font-semibold">{pct(c.approved, c.approved + c.rejected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
