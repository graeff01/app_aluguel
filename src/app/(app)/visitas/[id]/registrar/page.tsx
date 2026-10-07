import Link from "next/link";
import { requireActor, orNotFound } from "@/lib/require";
import { getVisitDetail } from "@/server/queries";
import { canConcludeVisit, canCorrectVisitData } from "@/lib/authz";
import { db } from "@/lib/db";
import { fmt } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { Alert, Panel } from "@/components/ui";
import { OutcomeForm } from "./outcome-form";
import { notFound } from "next/navigation";

export const metadata = { title: "Registrar resultado" };

export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const { visit, settings } = await orNotFound(getVisitDetail(actor, id));
  if (!canConcludeVisit(actor, visit)) notFound();
  const reasons = await db.reason.findMany({
    where: { kind: "VISIT_NEGATIVE", OR: [{ active: true }, ...(visit.negativeReasonId ? [{ id: visit.negativeReasonId }] : [])] },
    orderBy: { sortOrder: "asc" },
    select: { id: true, label: true },
  });
  const missing = [!visit.clientName?.trim() && "nome do cliente", !visit.propertyCode?.trim() && "código do imóvel"].filter(Boolean) as string[];
  const isEdit = visit.status !== "SCHEDULED" && !visit.autoCanceled;
  const now = new Date();
  return (
    <>
      <Link href={`/visitas/${visit.id}`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Detalhes da visita
      </Link>
      <h1 className="mb-3 text-2xl font-bold">{isEdit ? "Alterar resultado" : "Registrar resultado"}</h1>
      {visit.excluded && <Alert tone="warn" title="Esta visita foi excluída dos indicadores pela gestão." />}
      <Panel className="mb-6">
        <p className="text-sm text-ink-3">
          {fmt.shortDate(visit.scheduledStart)} · {fmt.time(visit.scheduledStart)}–{fmt.time(visit.scheduledEnd)}
        </p>
        <p className="text-lg font-semibold">{visit.clientName ?? <span className="text-warn">Cliente sem nome</span>}</p>
        <p className="text-ink-2">
          Imóvel <strong className="text-ink">{visit.propertyCode ?? "—"}</strong>
          {visit.phoneRaw ? <> · {formatPhone(visit.phoneNormalized, visit.phoneRaw)}</> : <> · <span className="text-warn">sem telefone</span></>}
        </p>
        <p className="text-ink-2">Responsável: {visit.consultant?.name ?? "—"}</p>
        {canCorrectVisitData(actor, visit, settings) && (
          <Link href={`/visitas/${visit.id}/corrigir?voltar=registrar`} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary">
            Dados errados? Corrigir
          </Link>
        )}
      </Panel>
      <OutcomeForm
        visitId={visit.id}
        version={visit.version}
        missingData={missing}
        canCorrect={canCorrectVisitData(actor, visit, settings)}
        noteMax={settings.noteMaxLength}
        reasons={reasons}
        isEdit={isEdit}
        future={visit.scheduledStart.getTime() > now.getTime() + 15 * 60_000}
        initial={{
          status: isEdit ? (visit.status as "DONE") : null,
          evaluation: isEdit ? visit.evaluation : null,
          negativeReasonId: isEdit ? visit.negativeReasonId : null,
          note: isEdit ? (visit.note ?? "") : "",
        }}
      />
    </>
  );
}
