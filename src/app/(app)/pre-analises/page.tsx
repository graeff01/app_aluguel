import Link from "next/link";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/require";
import { canCreatePreAnalysis, hasGlobalView, isPreService } from "@/lib/authz";
import { listPreAnalyses, preAnalysisStats } from "@/server/pre-analysis";
import { INCOME_BAND_LABEL, PRE_STATUS_LABEL } from "@/lib/labels";
import { fmt, dayKey, startOfDayInTz } from "@/lib/time";
import { relativeTime } from "@/lib/visit-tone";
import { Empty, LinkButton, PageHeader, Segmented, cx } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "Pré-análises" };

const STATUS_CLS: Record<string, string> = {
  AWAITING: "bg-accent-soft text-accent-strong",
  PENDING: "bg-[#e7effc] text-[#2357b3] dark:bg-[#1f2c44] dark:text-[#93b8ff]",
  APPROVED: "bg-good-soft text-good",
  REJECTED: "bg-bad-soft text-bad",
};

/** Mês "YYYY-MM" (ou o atual): início, fim e nome; e os vizinhos para as setas. */
function monthOf(key: string | undefined, now: Date) {
  const k = key && /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? key : dayKey(now).slice(0, 7);
  const [y, m] = k.split("-").map(Number);
  const shift = (d: number) => {
    const t = y * 12 + (m - 1) + d;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  };
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
  return { key: k, from: startOfDayInTz(`${k}-01`), to: startOfDayInTz(`${shift(1)}-01`), label, prev: shift(-1), next: shift(1), current: k === dayKey(now).slice(0, 7) };
}

function monthRange(now: Date) {
  const k = dayKey(now).slice(0, 7);
  const [y, m] = k.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: startOfDayInTz(`${k}-01`), to: startOfDayInTz(`${next}-01`), label: new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" }).format(now) };
}

export default async function PreAnalysesPage({ searchParams }: { searchParams: Promise<{ aba?: string; q?: string; excluida?: string; consultora?: string; mes?: string }> }) {
  const actor = await requireActor({ preService: true });
  const sp = await searchParams;
  const tab = sp.aba === "respondidas" ? "respondidas" : "abertas";
  const now = new Date();
  const byConsultant = actor.role !== "CONSULTANT";
  // respondidas: por mês da resposta (o atual por padrão); em aberto: todas
  const month = monthOf(sp.mes, now);
  const rows = await listPreAnalyses(actor, { tab, q: sp.q, consultantId: byConsultant ? sp.consultora : undefined, ...(tab === "respondidas" ? { answeredFrom: month.from, answeredTo: month.to } : {}) });
  // consultoras que recebem pré-análises (para o filtro)
  const consultants = byConsultant ? await db.user.findMany({ where: { role: "CONSULTANT", OR: [{ active: true }, { preAnalysesAssigned: { some: {} } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const link = (o: { aba?: string; consultora?: string; mes?: string }) => {
    const p = new URLSearchParams();
    const aba = "aba" in o ? o.aba : tab === "respondidas" ? "respondidas" : undefined;
    const c = "consultora" in o ? o.consultora : sp.consultora;
    const mes = "mes" in o ? o.mes : sp.mes;
    if (aba) p.set("aba", aba);
    if (c) p.set("consultora", c);
    if (mes && aba === "respondidas") p.set("mes", mes);
    if (sp.q) p.set("q", sp.q);
    const qs = p.toString();
    return `/pre-analises${qs ? `?${qs}` : ""}`;
  };
  const showStats = hasGlobalView(actor) || isPreService(actor);
  const range = monthRange(now);
  const stats = showStats ? await preAnalysisStats(actor, range.from, range.to) : null;
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  return (
    <>
      <PageHeader
        title="Pré-análises"
        subtitle={actor.role === "CONSULTANT" ? "Encaminhadas para você pelo pré-atendimento. Faça a análise e responda aqui." : "Dados do titular para análise antes de agendar a visita."}
        action={
          canCreatePreAnalysis(actor) ? (
            <LinkButton href="/pre-analises/nova">
              <Icon name="plus" className="size-4" /> Nova pré-análise
            </LinkButton>
          ) : undefined
        }
      />
      {sp.excluida && <p role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">Pré-análise excluída.</p>}

      {stats && (
        <section aria-label={`Indicadores de ${range.label}`} className="mb-8">
          <p className="mb-2 text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">Em {range.label}</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5 sm:gap-3">
            {[
              { label: "Enviadas", value: String(stats.total), detail: `${stats.awaiting} aguardando` },
              { label: "Aprovadas", value: String(stats.approved), detail: `taxa ${pct(stats.approvalRate)}`, tone: "text-good" },
              { label: "Reprovadas", value: String(stats.rejected), detail: "das respondidas", tone: stats.rejected ? "text-bad" : "" },
              { label: "Pendentes", value: String(stats.pending), detail: "faltando algo" },
              { label: "Tempo de resposta", value: stats.avgResponseHours === null ? "—" : stats.avgResponseHours < 1 ? `${Math.round(stats.avgResponseHours * 60)} min` : `${stats.avgResponseHours.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`, detail: "média" },
            ].map((t, i) => (
              <div key={t.label} className={cx("rounded-3xl border border-line bg-surface px-4 py-3.5 shadow-card", i === 0 && "col-span-2 sm:col-span-1")}>
                <p className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{t.label}</p>
                <p className={cx("num mt-0.5 text-[26px] leading-none font-bold", t.tone)}>{t.value}</p>
                <p className="mt-1 text-[12px] text-ink-3">{t.detail}</p>
              </div>
            ))}
          </div>
          {stats.total > 0 && (
            <div className="mt-3 rounded-3xl border border-line bg-surface p-4 shadow-card">
              <p className="mb-3 text-sm font-semibold">Funil do mês</p>
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ["Enviadas", stats.total],
                  ["Aprovadas", stats.approved],
                  ["Viraram visita", stats.withVisit],
                  ["Visitaram", stats.visited],
                  ["Locações", stats.leased],
                ].map(([label, n], i, arr) => (
                  <li key={String(label)} className="rounded-2xl bg-tint px-3 py-2.5">
                    <p className="num text-[22px] leading-none font-bold">{n}</p>
                    <p className="mt-1 text-[12px] text-ink-3">
                      {label}
                      {i > 0 && Number(arr[i - 1][1]) > 0 ? ` · ${Math.round((Number(n) / Number(arr[i - 1][1])) * 100)}%` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {stats.byConsultant.length > 0 && (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
                <p className="mb-2 text-sm font-semibold">Por consultora</p>
                <ul className="space-y-1.5 text-[13px]">
                  {stats.byConsultant.map(([name, e]) => (
                    <li key={name} className="flex justify-between gap-2">
                      <span>{name}</span>
                      <span className="num text-ink-2">
                        {e.total} · <span className="text-good">{e.approved} aprov.</span> · <span className="text-bad">{e.rejected} reprov.</span> · {e.pending + e.awaiting} em aberto
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
                <p className="mb-2 text-sm font-semibold">Por faixa de renda</p>
                <ul className="space-y-1.5 text-[13px]">
                  {stats.byIncome.map(([band, e]) => (
                    <li key={band} className="flex justify-between gap-2">
                      <span>{INCOME_BAND_LABEL[band] ?? band}</span>
                      <span className="num text-ink-2">
                        {e.total} · aprovação {e.approved + e.rejected ? `${Math.round((e.approved / (e.approved + e.rejected)) * 100)}%` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Situação"
          items={[
            { href: link({ aba: undefined }), label: "Em aberto", active: tab === "abertas" },
            { href: link({ aba: "respondidas" }), label: "Respondidas", active: tab === "respondidas" },
          ]}
        />
        <form role="search" className="w-full sm:w-72">
          {tab === "respondidas" && <input type="hidden" name="aba" value="respondidas" />}
          {sp.consultora && <input type="hidden" name="consultora" value={sp.consultora} />}
          {sp.mes && tab === "respondidas" && <input type="hidden" name="mes" value={sp.mes} />}
          <label htmlFor="q" className="sr-only">
            Buscar por nome
          </label>
          <input id="q" name="q" type="search" defaultValue={sp.q} placeholder="Buscar por nome" className="block min-h-11 w-full rounded-full border border-line-strong bg-surface px-5 text-[15px] shadow-card focus:border-ink focus:outline-none" />
        </form>
      </div>

      {consultants.length > 1 && (
        <nav aria-label="Filtrar por consultora" className="mb-4 flex flex-wrap items-center gap-2">
          {[{ id: "", name: "Todas" }, ...consultants].map((c) => {
            const on = (sp.consultora ?? "") === c.id;
            return (
              <Link key={c.id || "todas"} href={link({ consultora: c.id || undefined })} aria-current={on ? "true" : undefined} className={cx("press inline-flex min-h-10 items-center rounded-full border px-4 text-[13px] font-semibold", on ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink-2 hover:bg-tint")}>
                {c.id ? c.name.split(" ")[0] : c.name}
              </Link>
            );
          })}
          <span className="ml-auto text-[13px] text-ink-2">
            <strong className="num text-ink">{rows.length}</strong> {tab === "abertas" ? "em aberto" : `respondida${rows.length === 1 ? "" : "s"} em ${month.label.split(" ")[0]}`}
            {sp.consultora ? ` para ${consultants.find((c) => c.id === sp.consultora)?.name.split(" ")[0] ?? "a consultora"}` : ""}
          </span>
        </nav>
      )}
      {tab === "respondidas" && (
        <nav aria-label="Mês" className="mb-4 flex items-center gap-1">
          <Link href={link({ mes: month.prev })} aria-label="Mês anterior" className="press grid size-10 place-items-center rounded-full border border-line-strong bg-surface text-[18px]">
            ‹
          </Link>
          <span className="min-w-40 text-center text-[15px] font-semibold capitalize">{month.label}</span>
          {month.current ? (
            <span aria-hidden className="grid size-10 place-items-center text-[18px] text-ink-3/40">›</span>
          ) : (
            <Link href={link({ mes: month.next })} aria-label="Próximo mês" className="press grid size-10 place-items-center rounded-full border border-line-strong bg-surface text-[18px]">
              ›
            </Link>
          )}
          {!month.current && (
            <Link href={link({ mes: undefined })} className="ml-2 text-[13px] font-semibold text-ink-2 underline underline-offset-2">
              Mês atual
            </Link>
          )}
        </nav>
      )}

      {rows.length === 0 ? (
        <Empty title={tab === "abertas" ? "Nada em aberto" : "Nenhuma respondida ainda"} icon="✓">
          {tab === "abertas" && canCreatePreAnalysis(actor) ? "Use “Nova pré-análise” para enviar os dados de um cliente à consultora." : undefined}
        </Empty>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((r, i) => (
            <li key={r.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <Link href={`/pre-analises/${r.id}`} className="press block h-full rounded-3xl border border-line bg-surface p-4 shadow-card hover:shadow-float">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[16px] font-bold">{r.fullName || "Titular sem nome"}</p>
                  <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold", STATUS_CLS[r.status])}>{PRE_STATUS_LABEL[r.status]}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-2">
                  {actor.role === "CONSULTANT" ? `Enviada por ${r.createdBy.name.split(" ")[0]}` : `Para ${r.consultant.name}`} · {INCOME_BAND_LABEL[r.incomeBand]}
                  {r._count.files > 0 && ` · 📎 ${r._count.files} doc${r._count.files > 1 ? "s" : ""}`}
                  {r.propertyCode ? ` · imóvel ${r.propertyCode}` : ""}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Enviada {relativeTime(r.createdAt, now)} ({fmt.dateTime(r.createdAt)})
                  {r.resultAt ? ` · respondida ${relativeTime(r.resultAt, now)}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
