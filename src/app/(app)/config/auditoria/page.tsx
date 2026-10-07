import Link from "next/link";
import { requireAdmin } from "@/lib/require";
import { db } from "@/lib/db";
import { fmt } from "@/lib/time";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Auditoria" };

const LINK: Record<string, string> = { Visit: "/visitas/", Opportunity: "/oportunidades/", Client: "/clientes/", User: "/config/usuarios/" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ pagina?: string; entidade?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const where = sp.entidade ? { entityId: sp.entidade } : {};
  const logs = await db.auditLog.findMany({ where, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 });
  return (
    <>
      <PageHeader title="Auditoria" subtitle="Registro de alterações (acesso restrito à gestão)." />
      <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card text-sm">
        {logs.map((l) => (
          <li key={l.id} className="px-4 py-3">
            <p className="text-ink-3">
              {fmt.dateTime(l.createdAt)} · {l.actor?.name ?? "Sistema"}
            </p>
            <p className="font-medium">
              {l.action}{" "}
              {LINK[l.entityType] ? (
                <Link className="text-primary underline" href={`${LINK[l.entityType]}${l.entityId}`}>
                  {l.entityType}
                </Link>
              ) : (
                l.entityType
              )}
            </p>
            {l.changes && <pre className="mt-1 overflow-x-auto text-xs whitespace-pre-wrap text-ink-2">{JSON.stringify(l.changes, null, 1)}</pre>}
          </li>
        ))}
      </ul>
      <nav className="mt-4 flex justify-between">
        {page > 1 ? <Link className="text-primary" href={`?pagina=${page - 1}`}>← Mais recentes</Link> : <span />}
        {logs.length === 50 && <Link className="text-primary" href={`?pagina=${page + 1}`}>Mais antigos →</Link>}
      </nav>
    </>
  );
}
