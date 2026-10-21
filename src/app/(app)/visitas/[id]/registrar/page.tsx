import Link from "next/link";
import { ClientFileLink } from "@/components/client-file-link";
import { requireActor, orNotFound } from "@/lib/require";
import { getVisitDetail } from "@/server/queries";
import { canConcludeVisit, canCorrectVisitData, hasGlobalView } from "@/lib/authz";
import { db } from "@/lib/db";
import { fmt } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { revisitLabel, scheduledByConsultant } from "@/lib/labels";
import { Alert, Panel } from "@/components/ui";
import { OutcomeForm } from "./outcome-form";
import { AfterVisitMessage } from "@/components/after-visit-message";
import { ContactButtons } from "@/components/contact-buttons";
import { notFound } from "next/navigation";
import { visitBrief } from "@/server/brief";
import { VisitBrief } from "@/components/visit-brief";
import { propertyUrl } from "@/server/property-preview";
import { isMobileRequest } from "@/lib/session";

export const metadata = { title: "Registrar resultado" };

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ anterior?: string; restantes?: string; desfeito?: string; r?: string; desfazer?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const { id } = await params;
  const { visit, sameEvent, settings } = await orNotFound(getVisitDetail(actor, id));
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
  const brief = await visitBrief(actor, visit.id);
  // antes/durante a visita (ou no computador) a ficha vem aberta; depois, no celular, o formulário vem primeiro
  const briefOpen = visit.scheduledEnd > now || !(await isMobileRequest());
  const siteUrl = visit.propertyCode && settings.propertyUrlTemplate.includes("{codigo}") ? propertyUrl(settings.propertyUrlTemplate, visit.propertyCode) : null;
  const future = visit.scheduledStart.getTime() > now.getTime() + 15 * 60_000;
  // atalho da notificação ("Gostou", "Não gostou", "Não veio"): já vem marcado; a observação continua obrigatória
  const preset = !isEdit && !future && visit.status === "SCHEDULED" ? sp.r : undefined;
  const presetStatus = preset === "NO_SHOW" ? ("NO_SHOW" as const) : preset === "POSITIVE" || preset === "NEGATIVE" || preset === "UNDECIDED" ? ("DONE" as const) : null;
  const presetEval = presetStatus === "DONE" ? (preset as "POSITIVE" | "NEGATIVE" | "UNDECIDED") : null;
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
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            {sp.desfazer && <AfterVisitMessage actor={actor} visitId={sp.desfazer.split(".")[0]} />}
            <Link href={global ? "/hoje" : "/minhas"} className="font-semibold underline">
              Parar
            </Link>
          </span>
        </div>
      )}
      {visit.linkCode && !visit.sourceEventId && !visit.googleCreatedAt && visit.status === "SCHEDULED" && (
        <Link href={`/visitas/${visit.id}/agenda`} className="press mb-5 flex items-center justify-between gap-3 rounded-2xl border border-warn/25 bg-warn-soft px-4 py-3 text-sm text-warn">
          <span>
            <strong>Falta colocar na agenda Google.</strong> Um toque abre o evento já preenchido.
          </span>
          <span aria-hidden className="text-lg">→</span>
        </Link>
      )}
      <h1 className="mb-3 text-[28px] leading-tight font-bold tracking-[-0.03em]">{isEdit ? "Alterar resultado" : future ? "Próxima visita" : "Registrar resultado"}</h1>
      {visit.excluded && <Alert tone="warn" title="Esta visita foi excluída dos indicadores pela gestão." />}
      <div className="lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[400px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24">
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
        <ClientFileLink clientId={visit.clientId} className="mt-2" />
        {visit.revisit && (
          <p className="text-ink-2">
            ↺ <strong className="text-ink">Revisita</strong> · {revisitLabel(visit.revisit).toLowerCase()}
            {visit.revisit.sameProperty ? " (inclusive este imóvel)" : ""}
          </p>
        )}
        {scheduledByConsultant(visit) && <p className="text-ink-2">Agendada pela consultora{visit.scheduledBy && visit.scheduledBy.id !== visit.consultantId ? ` ${visit.scheduledBy.name}` : ""}.</p>}
        <ContactButtons phone={visit.phoneNormalized} name={visit.clientName} compact className="mt-3" />
        {!visit.excluded && visit.clientName && visit.propertyCode && (
          <Link href={`/visitas/${visit.id}/reagendar`} className="press mt-3 flex min-h-11 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface text-[14px] font-semibold">
            <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
              <path d="M8 3v4M16 3v4M3.5 10h17M9.5 15.5l2 2 3.5-4" />
            </svg>
            {visit.status === "SCHEDULED" ? "Reagendar (já coloca na agenda)" : "Marcar nova visita para este cliente"}
          </Link>
        )}
        {canCorrectVisitData(actor, visit, settings) && (
          <Link href={`/visitas/${visit.id}/corrigir?voltar=registrar`} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary">
            Dados errados? Corrigir
          </Link>
        )}
      </Panel>
      {visit.status === "DONE" && visit.evaluation === "POSITIVE" && (
        <Link href={`/visitas/${visit.id}/documentos`} className="press animate-rise mb-5 flex items-center justify-between gap-3 rounded-[22px] border border-accent/30 bg-accent-soft px-5 py-4">
          <span>
            <span className="block text-[16px] font-bold">Pedir documentos ao cliente</span>
            <span className="text-[13px] text-ink-2">Link seguro: ele fotografa pelo celular e você é avisada.</span>
          </span>
          <span aria-hidden className="text-xl text-accent-strong">→</span>
        </Link>
      )}
      <VisitBrief data={brief} siteUrl={siteUrl} open={briefOpen} />
      </aside>
      <div className="min-w-0 lg:rounded-[26px] lg:border lg:border-line lg:bg-surface lg:p-7 lg:shadow-card">
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
        future={future}
        preset={presetStatus ? { status: presetStatus, evaluation: presetEval } : undefined}
        otherCodes={sameEvent.filter((s) => s.status === "SCHEDULED").map((s) => s.propertyCode ?? "sem código")}
        initial={{
          status: isEdit ? (visit.status as "DONE") : null,
          evaluation: isEdit ? visit.evaluation : null,
          negativeReasonId: isEdit ? visit.negativeReasonId : null,
          note: isEdit ? (visit.note ?? "") : "",
        }}
      />
      </div>
      </div>
    </>
  );
}
