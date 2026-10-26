import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { listOpportunities } from "@/server/queries";
import { lastActivityOf } from "@/server/insights";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { dayKey, fmt, startOfDayInTz } from "@/lib/time";
import { dealFunnel } from "@/server/deal-flow";
import { DEAL_STAGES, FELL_LABEL, FOLLOW_UP_LABEL, STAGE_LABEL, fellInDeal, situationLabel } from "@/lib/deal-stages";
import { Badge, Empty, Field, Input, PageHeader, Segmented, Select } from "@/components/ui";
import { Board, type BoardCard } from "./board";

export const metadata = { title: "Andamento" };

export default async function OppsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const global = hasGlobalView(actor);
  const board = sp.vista === "quadro";
  const settings = await getSettings();
  const now = Date.now();
  const opps = await listOpportunities(actor, { status: board ? "ALL" : sp.situacao, consultantId: sp.consultora, q: sp.q });
  const withIdle = opps.map((o) => {
    const last = lastActivityOf(o);
    const idleDays = Math.floor((now - last.getTime()) / 86400_000);
    const active = o.status === "FOLLOW_UP" || o.status === "DOCS_REVIEW";
    // parado: tempo na situação atual (e sem visita nova)
    const sinceStage = Math.floor((now - Math.max(o.stageChangedAt.getTime(), last.getTime())) / 86400_000);
    return { ...o, idleDays: sinceStage, stale: active && sinceStage >= settings.staleOpportunityDays };
  });
  const list = sp.paradas ? withIdle.filter((o) => o.stale).sort((a, b) => b.idleDays - a.idleDays) : withIdle;
  const consultants = global ? await db.user.findMany({ where: { role: "CONSULTANT" }, select: { id: true, name: true } }) : [];
  // funil do mês (1ª visita no mês) e VGL dos contratos assinados no mês
  const monthKey = dayKey(new Date()).slice(0, 7);
  const [y, m] = monthKey.split("-").map(Number);
  const monthEnd = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const funnel = await dealFunnel(actor, { from: startOfDayInTz(`${monthKey}-01`), to: startOfDayInTz(monthEnd), consultantId: global ? sp.consultora || null : actor.id });
  const maxReach = Math.max(1, funnel.total);
  const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const keep = (over: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    for (const [k, v] of Object.entries(over)) v === null ? p.delete(k) : p.set(k, v);
    return `?${p}`;
  };
  const activeFilters = [sp.situacao && sp.situacao !== "OPEN", sp.consultora, sp.q, sp.paradas].filter(Boolean).length;
  const cards: BoardCard[] = withIdle.map((o) => ({
    id: o.id,
    version: o.version,
    column: o.status === "LOST" ? (fellInDeal(o) ? "FELL_DEAL" : "FELL_VISIT") : o.stage ?? (o.status === "CLOSED_WON" ? "SIGNED" : "FOLLOW"),
    client: o.client.name,
    property: o.property.code,
    responsible: o.responsible?.name ?? null,
    visits: o._count.visits,
    idleDays: o.idleDays,
    stale: o.stale,
    photoUrl: null,
  }));

  return (
    <>
      <PageHeader
        title="Andamento"
        subtitle="Negócios depois da visita, situação por situação até a posse. Atualize a cada etapa."
        action={
          <Segmented
            label="Visualização"
            items={[
              { href: keep({ vista: null }), label: "Lista", active: !board },
              { href: keep({ vista: "quadro" }), label: "Quadro", active: board },
            ]}
          />
        }
      />

      <section aria-label="Funil do mês" className="mb-6 grid gap-3 lg:grid-cols-[1fr_280px]">
        <div className="rounded-3xl border border-line bg-surface p-5 shadow-card">
          <p className="mb-3 text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">Funil do mês · {funnel.total} negócio{funnel.total === 1 ? "" : "s"} com 1ª visita no mês</p>
          <ul className="space-y-1.5">
            {funnel.reached.map((r) => (
              <li key={r.stage} className="grid grid-cols-[minmax(0,250px)_1fr_auto] items-center gap-3 text-[13px]">
                <span className="truncate text-ink-2">{r.label}</span>
                <span className="h-5 overflow-hidden rounded-full bg-tint" aria-hidden>
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.count / maxReach) * 100}%` }} />
                </span>
                <span className="num whitespace-nowrap">
                  <strong>{r.count}</strong>
                  {r.lost > 0 && <span className="text-bad"> · caiu {r.lost}</span>}
                  {funnel.avgDays[r.stage] !== null && <span className="text-ink-3"> · {String(funnel.avgDays[r.stage]).replace(".", ",")} d</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-ink-3">Barra: quantos chegaram à etapa. “caiu”: quantos caíram nela. “d”: dias, em média, até a etapa seguinte.</p>
        </div>
        <div className="rounded-3xl border border-line bg-surface p-5 shadow-card">
          <p className="text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">VGL do mês</p>
          <p className="num mt-2 text-[30px] leading-none font-bold tracking-[-0.03em]">{brl(funnel.vgl.totalCents)}</p>
          <p className="mt-2 text-[13px] text-ink-3">
            {funnel.vgl.contracts} contrato{funnel.vgl.contracts === 1 ? "" : "s"} assinado{funnel.vgl.contracts === 1 ? "" : "s"}
            {funnel.vgl.contracts ? ` · ${funnel.vgl.lease} locação · ${funnel.vgl.intermediation} intermediação` : ""}
          </p>
        </div>
      </section>

      <details className="mb-6" open={activeFilters > 0}>
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold shadow-card">
          Filtros{activeFilters ? ` (${activeFilters})` : ""}
        </summary>
        <form className="mt-3 grid gap-x-3 rounded-3xl border border-line bg-surface p-5 shadow-card sm:grid-cols-3">
          {board && <input type="hidden" name="vista" value="quadro" />}
          {!board && (
            <Field label="Situação" htmlFor="situacao">
              <Select id="situacao" name="situacao" defaultValue={sp.situacao ?? "OPEN"}>
                <option value="OPEN">Abertas</option>
                <option value="FOLLOW">{FOLLOW_UP_LABEL}</option>
                {DEAL_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
                <option value="LOST">{FELL_LABEL}</option>
              </Select>
            </Field>
          )}
          {global && (
            <Field label="Responsável" htmlFor="consultora">
              <Select id="consultora" name="consultora" defaultValue={sp.consultora ?? ""}>
                <option value="">Todas</option>
                {consultants.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Cliente ou imóvel" htmlFor="q">
            <Input id="q" name="q" defaultValue={sp.q} type="search" />
          </Field>
          <label className="mb-5 flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="paradas" value="1" defaultChecked={!!sp.paradas} className="size-5 accent-[var(--accent)]" />
            Só paradas há {settings.staleOpportunityDays}+ dias
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <button className="min-h-12 rounded-full bg-primary px-6 font-semibold text-on-primary">Aplicar</button>
            <Link href={board ? "?vista=quadro" : "/oportunidades"} className="inline-flex min-h-12 items-center px-4 text-sm font-semibold text-ink-2">
              Limpar
            </Link>
          </div>
        </form>
      </details>

      {board ? (
        <Board cards={sp.paradas ? cards.filter((c) => c.stale) : cards} />
      ) : list.length === 0 ? (
        <Empty title="Nenhuma oportunidade" />
      ) : (
        <ul className="space-y-3">
          {list.map((o, i) => (
            <li key={o.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}>
              <Link href={`/oportunidades/${o.id}`} className="press block rounded-3xl border border-line bg-surface p-4 shadow-card hover:shadow-float">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{o.client.name}</p>
                    <p className="text-ink-2">
                      Imóvel {o.property.code} · ciclo {o.cycle} · {o._count.visits} visita{o._count.visits === 1 ? "" : "s"}
                    </p>
                    <p className="text-sm text-ink-3">
                      1ª visita {fmt.date(o.firstDoneVisitAt)} · {o.responsible?.name ?? "sem responsável"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Badge tone={o.status === "CLOSED_WON" ? "good" : o.status === "LOST" ? "bad" : "info"}>{situationLabel(o)}</Badge>
                    {o.stale && <Badge tone="accent">Parado há {o.idleDays} dias</Badge>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
