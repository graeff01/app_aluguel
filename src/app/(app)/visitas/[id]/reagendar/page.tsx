import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor, orNotFound } from "@/lib/require";
import { getVisitDetail } from "@/server/queries";
import { canConcludeVisit } from "@/lib/authz";
import { addDays, dayKey, fmt } from "@/lib/time";
import { RescheduleForm } from "./form";

export const metadata = { title: "Reagendar visita" };

export default async function ReschedulePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const { visit } = await orNotFound(getVisitDetail(actor, id));
  if (!canConcludeVisit(actor, visit) || visit.excluded) notFound();
  const canReschedule = visit.status === "SCHEDULED";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(visit.scheduledStart);
  const duration = Math.round((visit.scheduledEnd.getTime() - visit.scheduledStart.getTime()) / 60_000);
  return (
    <div className="mx-auto max-w-xl">
      <Link href={`/visitas/${visit.id}/registrar`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Voltar à visita
      </Link>
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">{canReschedule ? "Reagendar visita" : "Nova visita para o cliente"}</h1>
      <p className="mt-1.5 mb-6 text-[15px] text-ink-2">
        {visit.clientName ?? "Cliente"} · imóvel {visit.propertyCode ?? "—"} · hoje marcada para {fmt.shortDate(visit.scheduledStart)} às {fmt.time(visit.scheduledStart)}
      </p>
      {!visit.clientName || !visit.propertyCode ? (
        <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">Complete o nome do cliente e o código do imóvel antes de reagendar (Corrigir dados).</p>
      ) : (
        <RescheduleForm visitId={visit.id} canReschedule={canReschedule} defaultDate={addDays(dayKey(new Date()), 1)} defaultTime={time} defaultDuration={[30, 45, 60, 90, 120].includes(duration) ? duration : 60} />
      )}
    </div>
  );
}
