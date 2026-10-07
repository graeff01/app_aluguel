import Link from "next/link";
import { requireManager } from "@/lib/require";
import { listClients } from "@/server/queries";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { Badge, Empty, Field, Input, PageHeader, Select } from "@/components/ui";

export const metadata = { title: "Clientes" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireManager();
  const sp = await searchParams;
  const [clients, pending] = await Promise.all([listClients({ q: sp.q, identity: sp.identidade }), db.client.count({ where: { identityStatus: "PENDING", mergedIntoId: null } })]);
  return (
    <>
      <PageHeader title="Clientes" subtitle={`${pending} cadastro${pending === 1 ? "" : "s"} com identificação pendente (não contam como pessoas únicas confirmadas)`} />
      <form className="mb-5 grid gap-x-3 rounded-3xl border border-line bg-surface p-5 shadow-card sm:grid-cols-3">
        <Field label="Nome ou telefone" htmlFor="q">
          <Input id="q" name="q" type="search" defaultValue={sp.q} />
        </Field>
        <Field label="Identificação" htmlFor="identidade">
          <Select id="identidade" name="identidade" defaultValue={sp.identidade ?? ""}>
            <option value="">Todas</option>
            <option value="CONFIRMED">Confirmada</option>
            <option value="PENDING">Pendente</option>
          </Select>
        </Field>
        <div className="flex items-end pb-4">
          <button className="min-h-12 rounded-full bg-primary px-6 font-semibold text-on-primary shadow-float">Buscar</button>
        </div>
      </form>
      {clients.length === 0 ? (
        <Empty title="Nenhum cliente encontrado" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
          {clients.map((c) => (
            <li key={c.id}>
              <Link href={`/clientes/${c.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-bg">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="text-sm text-ink-3">
                    {c.phones.map((p) => formatPhone(p.normalized, p.raw)).join(", ") || "sem telefone"} · {c._count.visits} visita(s)
                  </span>
                </span>
                <Badge tone={c.identityStatus === "CONFIRMED" ? "good" : "warn"}>{c.identityStatus === "CONFIRMED" ? "Confirmada" : "Pendente"}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
