import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { listOpportunities } from "@/server/queries";
import { lastActivityOf } from "@/server/insights";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { fmt } from "@/lib/time";
import { OPP_STATUS_LABEL } from "@/lib/labels";
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
    return { ...o, idleDays, stale: active && idleDays >= settings.staleOpportunityDays };
  });
  const list = sp.paradas ? withIdle.filter((o) => o.stale).sort((a, b) => b.idleDays - a.idleDays) : withIdle;
  const consultants = global ? await db.user.findMany({ where: { role: "CONSULTANT" }, select: { id: true, name: true } }) : [];
  const keep = (over: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    for (const [k, v] of Object.entries(over)) v === null ? p.delete(k) : p.set(k, v);
    return `?${p}`;
  };
  const activeFilters = [sp.situacao && sp.situacao !== "OPEN", sp.consultora, sp.q, sp.paradas].filter(Boolean).length;
  const cards: BoardCard[] = withIdle.map((o) => ({
    id: o.id,
    version: o.version,
    status: o.status,
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
        subtitle="Oportunidades cliente–imóvel após a visita. Avaliação positiva não é contrato fechado."
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
                <option value="FOLLOW_UP">Em acompanhamento</option>
                <option value="DOCS_REVIEW">Documentação em análise</option>
                <option value="CLOSED_WON">Locação fechada</option>
                <option value="LOST">Perdida</option>
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
                    <Badge tone={o.status === "CLOSED_WON" ? "good" : o.status === "LOST" ? "bad" : "info"}>{OPP_STATUS_LABEL[o.status]}</Badge>
                    {o.stale && <Badge tone="accent">Parada há {o.idleDays} dias</Badge>}
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
