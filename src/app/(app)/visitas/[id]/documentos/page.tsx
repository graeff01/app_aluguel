import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor, orNotFound } from "@/lib/require";
import { getVisitDetail } from "@/server/queries";
import { canConcludeVisit } from "@/lib/authz";
import { fmt } from "@/lib/time";
import { DocRequestsPanel } from "@/components/doc-requests/panel";
import { docLinksEnabled } from "@/server/doc-requests";
import { db } from "@/lib/db";
import { ClientFileLink } from "@/components/client-file-link";

export const metadata = { title: "Documentos do cliente" };

/** Depois da visita: pedir ao cliente os documentos da locação por um link seguro. */
export default async function VisitDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor({ preService: true });
  const { id } = await params;
  const { visit } = await orNotFound(getVisitDetail(actor, id));
  if (!canConcludeVisit(actor, visit) && actor.role !== "PRE_SERVICE") notFound();
  // desligado e nada recebido antes: a tela não tem o que mostrar
  if (!(await docLinksEnabled()) && !(await db.docRequest.count({ where: { OR: [{ visitId: visit.id }, ...(visit.opportunityId ? [{ opportunityId: visit.opportunityId }] : [])] } }))) notFound();
  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/visitas/${visit.id}/registrar`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Voltar à visita
      </Link>
      <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase">Documentos</p>
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">{visit.clientName ?? "Cliente"}</h1>
      <ClientFileLink clientId={visit.clientId} className="mt-2" />
      <p className="mt-3 mb-6 text-[15px] text-ink-2">
        Imóvel {visit.propertyCode ?? "—"} · visita de {fmt.shortDate(visit.scheduledStart)}
      </p>
      <DocRequestsPanel
        actor={actor}
        target={{ visitId: visit.id, opportunityId: visit.opportunityId }}
        hasPhone={!!visit.phoneNormalized}
        intro="O cliente gostou? Mande o link: ele fotografa os documentos pelo celular e você é avisada quando ele concluir."
      />
    </div>
  );
}
