import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { listHistory } from "@/server/queries";
import { db } from "@/lib/db";
import { Empty, Field, Input, PageHeader, Select } from "@/components/ui";
import { VisitCard } from "@/components/visit-card";

export const metadata = { title: "Histórico" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const global = hasGlobalView(actor);
  const result = await listHistory(actor, { q: sp.q, from: sp.de, to: sp.ate, status: sp.situacao, consultantId: sp.consultora, page: Number(sp.pagina) || 1 });
  const consultants = global ? await db.user.findMany({ where: { role: "CONSULTANT" }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const qs = (page: number) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    p.set("pagina", String(page));
    return `?${p}`;
  };
  return (
    <>
      <PageHeader
        title="Histórico"
        subtitle={`${result.total} visita${result.total === 1 ? "" : "s"}`}
        action={
          global && result.total > 0 ? (
            <a
              href={`/api/export/visitas?${new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "pagina") as [string, string][])}`}
              className="inline-flex min-h-12 items-center gap-2 rounded-full border border-line-strong bg-surface px-5 text-[15px] font-semibold shadow-card transition hover:border-ink-3"
              download
            >
              <span aria-hidden>↓</span> Exportar CSV
            </a>
          ) : undefined
        }
      />
      <form className="mb-6 rounded-3xl border border-line bg-surface p-5 shadow-card" role="search">
        <Field label="Buscar por nome, telefone ou código" htmlFor="q">
          <Input id="q" name="q" type="search" defaultValue={sp.q} placeholder="Ex.: Maria, 51 9..., 654321" />
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="De" htmlFor="de">
            <Input id="de" name="de" type="date" defaultValue={sp.de} />
          </Field>
          <Field label="Até" htmlFor="ate">
            <Input id="ate" name="ate" type="date" defaultValue={sp.ate} />
          </Field>
          <Field label="Situação" htmlFor="situacao">
            <Select id="situacao" name="situacao" defaultValue={sp.situacao ?? ""}>
              <option value="">Todas</option>
              <option value="SCHEDULED">Agendada / aguardando</option>
              <option value="DONE">Realizada</option>
              <option value="POSITIVE">— Positiva</option>
              <option value="NEGATIVE">— Negativa</option>
              <option value="UNDECIDED">— Ainda decidindo</option>
              <option value="NO_SHOW">Não compareceu</option>
              <option value="CANCELED">Cancelada</option>
              <option value="RESCHEDULED">Remarcada</option>
            </Select>
          </Field>
          {global && (
            <Field label="Consultora" htmlFor="consultora">
              <Select id="consultora" name="consultora" defaultValue={sp.consultora ?? ""}>
                <option value="">Todas</option>
                <option value="none">Sem consultora</option>
                {consultants.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="flex gap-2">
          <button className="min-h-12 rounded-full bg-primary px-6 font-semibold text-white shadow-float">Filtrar</button>
          <Link href="/historico" className="inline-flex min-h-12 items-center px-4 text-primary">
            Limpar
          </Link>
        </div>
      </form>
      {result.items.length === 0 ? (
        <Empty title="Nenhuma visita encontrada" />
      ) : (
        <ul className="space-y-3">
          {result.items.map((v) => (
            <VisitCard key={v.id} v={v} showConsultant={global} showDate />
          ))}
        </ul>
      )}
      {result.pages > 1 && (
        <nav aria-label="Paginação" className="mt-6 flex items-center justify-between">
          {result.page > 1 ? <Link className="min-h-12 px-3 py-3 text-primary" href={qs(result.page - 1)}>← Anteriores</Link> : <span />}
          <span className="text-ink-3">
            Página {result.page} de {result.pages}
          </span>
          {result.page < result.pages ? <Link className="min-h-12 px-3 py-3 text-primary" href={qs(result.page + 1)}>Próximas →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
