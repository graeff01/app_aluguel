import Link from "next/link";
import { requireActor, orNotFound } from "@/lib/require";
import { getVisitDetail } from "@/server/queries";
import { canConcludeVisit, canCorrectVisitData, hasGlobalView } from "@/lib/authz";
import { db } from "@/lib/db";
import { fmt } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { revisitLabel, scheduledByConsultant } from "@/lib/labels";
import { Alert, Panel } from "@/components/ui";
import { OutcomeForm } from "./outcome-form";
import { ContactButtons } from "@/components/contact-buttons";
import { PropertyCard } from "@/components/property-preview";
import { notFound } from "next/navigation";

export const metadata = { title: "Registrar resultado" };

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ anterior?: string; restantes?: string; desfeito?: string }> }) {
  const sp = await searchParams;
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
  const global = hasGlobalView(actor);
  return (
    <>
      <Link href={global ? `/visitas/${visit.id}` : "/minhas"} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← {global ? "Detalhes da visita" : "Minhas visitas"}
      </Link>
      {sp.desfeito && (
        <div role="status" className="mb-5 rounded-2xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent-strong">
          Registro desfeito. A visita voltou a aguardar resultado.
        </div>
      )}
      {sp.anterior === "salvo" && !sp.desfeito && (
        <div role="status" className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-good-soft px-4 py-3 text-sm text-good">
          <span>
            <strong>✓ Resultado anterior salvo.</strong> Esta é a próxima pendente{Number(sp.restantes) > 1 ? ` (${sp.restantes} na fila)` : ""}.
          </span>
          <Link href={global ? "/hoje" : "/minhas"} className="shrink-0 font-semibold underline">
            Parar
          </Link>
        </div>
      )}
      <h1 className="mb-3 text-[28px] leading-tight font-bold tracking-[-0.03em]">{isEdit ? "Alterar resultado" : "Registrar resultado"}</h1>
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
        {visit.revisit && (
          <p className="text-ink-2">
            ↺ <strong className="text-ink">Revisita</strong> · {revisitLabel(visit.revisit).toLowerCase()}
            {visit.revisit.sameProperty ? " (inclusive este imóvel)" : ""}
          </p>
        )}
        {scheduledByConsultant(visit) && <p className="text-ink-2">Agendada pela consultora{visit.scheduledBy && visit.scheduledBy.id !== visit.consultantId ? ` ${visit.scheduledBy.name}` : ""}.</p>}
        <ContactButtons phone={visit.phoneNormalized} name={visit.clientName} compact className="mt-3" />
        {canCorrectVisitData(actor, visit, settings) && (
          <Link href={`/visitas/${visit.id}/corrigir?voltar=registrar`} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary">
            Dados errados? Corrigir
          </Link>
        )}
      </Panel>
      <div className="mb-6">
        <PropertyCard code={visit.propertyCode} photoUrl={visit.property?.photoUrl} title={visit.property?.title} template={settings.propertyUrlTemplate} />
      </div>
      <OutcomeForm
        visitId={visit.id}
        version={visit.version}
        missingData={missing}
        canCorrect={canCorrectVisitData(actor, visit, settings)}
        noteMax={settings.noteMaxLength}
        reasons={reasons}
        isEdit={isEdit}
        afterSave={global ? `/visitas/${visit.id}?salvo=1` : "/minhas?salvo=1"}
        unlockLabel={fmt.time(new Date(visit.scheduledStart.getTime() - 15 * 60_000))}
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
