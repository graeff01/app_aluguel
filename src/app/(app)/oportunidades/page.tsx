import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { listOpportunities } from "@/server/queries";
import { db } from "@/lib/db";
import { fmt } from "@/lib/time";
import { OPP_STATUS_LABEL } from "@/lib/labels";
import { Badge, Empty, Field, Input, PageHeader, Select } from "@/components/ui";

export const metadata = { title: "Andamento" };

export default async function OppsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const global = hasGlobalView(actor);
  const opps = await listOpportunities(actor, { status: sp.situacao, consultantId: sp.consultora, q: sp.q });
  const consultants = global ? await db.user.findMany({ where: { role: "CONSULTANT" }, select: { id: true, name: true } }) : [];
  return (
    <>
      <PageHeader title="Andamento" subtitle="Oportunidades cliente–imóvel após a visita. Avaliação positiva não é contrato fechado." />
      <form className="mb-5 grid gap-x-3 rounded-3xl border border-line bg-surface p-5 shadow-card sm:grid-cols-3">
        <Field label="Situação" htmlFor="situacao">
          <Select id="situacao" name="situacao" defaultValue={sp.situacao ?? "OPEN"}>
            <option value="OPEN">Abertas</option>
            <option value="FOLLOW_UP">Em acompanhamento</option>
            <option value="DOCS_REVIEW">Documentação em análise</option>
            <option value="CLOSED_WON">Locação fechada</option>
            <option value="LOST">Perdida</option>
          </Select>
        </Field>
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
        <div>
          <button className="min-h-12 rounded-full bg-primary px-6 font-semibold text-white shadow-float">Filtrar</button>
        </div>
      </form>
      {opps.length === 0 ? (
        <Empty title="Nenhuma oportunidade" />
      ) : (
        <ul className="space-y-3">
          {opps.map((o) => (
            <li key={o.id}>
              <Link href={`/oportunidades/${o.id}`} className="block rounded-3xl border border-line bg-surface p-5 shadow-card hover:border-primary">
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
                  <Badge tone={o.status === "CLOSED_WON" ? "good" : o.status === "LOST" ? "bad" : "info"}>{OPP_STATUS_LABEL[o.status]}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
