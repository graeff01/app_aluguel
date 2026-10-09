import Link from "next/link";
import { requireManager, orNotFound } from "@/lib/require";
import { getClient } from "@/server/queries";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { OPP_STATUS_LABEL } from "@/lib/labels";
import { Badge, KeyValue, PageHeader, Panel, Section } from "@/components/ui";
import { VisitCard } from "@/components/visit-card";
import { MergeForm } from "./merge-form";
import { AnonymizeForm } from "./anonymize-form";

export const metadata = { title: "Cliente" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireManager();
  const { id } = await params;
  const c = await orNotFound(getClient(id));
  const normalized = c.phones.map((p) => p.normalized).filter(Boolean) as string[];
  const samePhone = normalized.length
    ? await db.client.findMany({ where: { id: { not: c.id }, mergedIntoId: null, phones: { some: { normalized: { in: normalized } } } }, select: { id: true, name: true } })
    : [];
  return (
    <>
      <Link href="/clientes" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Clientes
      </Link>
      <PageHeader title={c.name} subtitle={<Badge tone={c.identityStatus === "CONFIRMED" ? "good" : "warn"}>{c.identityStatus === "CONFIRMED" ? "Identidade confirmada" : "Identificação pendente"}</Badge>} />
      {c.mergedIntoId && <p className="mb-4 text-warn">Este cadastro foi unido a outro. <Link className="underline" href={`/clientes/${c.mergedIntoId}`}>Abrir cadastro principal</Link></p>}
      <Panel className="mb-6">
        <KeyValue items={[["Telefones", c.phones.map((p) => `${formatPhone(p.normalized, p.raw)}${p.valid ? "" : " (não validado)"}`).join(" · ") || "—"]]} />
      </Panel>
      <Section title="Unir cadastros">
        <MergeForm sourceId={c.id} suggestions={samePhone} />
      </Section>
      <Section title="Oportunidades">
        <ul className="space-y-2">
          {c.opportunities.map((o) => (
            <li key={o.id}>
              <Link href={`/oportunidades/${o.id}`} className="flex justify-between rounded-2xl border border-line bg-surface p-4 shadow-card hover:border-primary">
                <span>
                  Imóvel {o.property.code} · ciclo {o.cycle} · {o.responsible?.name ?? "—"}
                </span>
                <span>{OPP_STATUS_LABEL[o.status]}</span>
              </Link>
            </li>
          ))}
          {c.opportunities.length === 0 && <li className="text-ink-3">Nenhuma.</li>}
        </ul>
      </Section>
      <Section title="Visitas">
        <ul className="space-y-3">
          {c.visits.map((v) => (
            <VisitCard key={v.id} v={v} showDate showConsultant />
          ))}
        </ul>
      </Section>
      <Section title="Privacidade (LGPD)">
        {c.anonymizedAt ? (
          <p className="rounded-3xl border border-line bg-surface-2 p-5 text-sm text-ink-3">Dados pessoais removidos em {c.anonymizedAt.toLocaleDateString("pt-BR")}. Indicadores preservados.</p>
        ) : (
          <AnonymizeForm clientId={c.id} />
        )}
      </Section>
    </>
  );
}
