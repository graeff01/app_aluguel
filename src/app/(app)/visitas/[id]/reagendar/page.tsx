import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor, orNotFound } from "@/lib/require";
import { getVisitDetail } from "@/server/queries";
import { canConcludeVisit } from "@/lib/authz";
import { addDays, dayKey, fmt } from "@/lib/time";
import { RescheduleForm } from "./form";

export const metadata = { title: "Reagendar visita" };

export default async function ReschedulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nova?: string }> }) {
  const sp = await searchParams;
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
      {sp.nova && !canReschedule && <p role="status" className="mb-4 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">✓ Resultado salvo. Agora marque a nova visita.</p>}
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">{canReschedule ? "Reagendar visita" : "Nova visita para o cliente"}</h1>
      <p className="mt-2 rounded-2xl bg-tint px-4 py-2.5 text-[13px] text-ink-2">
        {canReschedule ? (
          <>
            A visita atual fica como <strong className="text-ink">Remarcada</strong> e a nova nasce marcada como remarcada (no Google, com “REAGENDADA” no título). Se a visita já aconteceu e o cliente quer outra,{" "}
            <Link href={`/visitas/${visit.id}/registrar`} className="font-semibold underline underline-offset-4">
              registre o resultado primeiro
            </Link>
            .
          </>
        ) : (
          <>O resultado desta visita já está registrado. A nova visita puxa o cliente; troque o código se for outro imóvel.</>
        )}
      </p>
      <p className="mt-3 mb-6 text-[15px] text-ink-2">
        {visit.clientName ?? "Cliente"} · imóvel {visit.propertyCode ?? "—"} · hoje marcada para {fmt.shortDate(visit.scheduledStart)} às {fmt.time(visit.scheduledStart)}
      </p>
      {!visit.clientName || !visit.propertyCode ? (
        <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">Complete o nome do cliente e o código do imóvel antes de reagendar (Corrigir dados).</p>
      ) : (
        <RescheduleForm visitId={visit.id} canReschedule={canReschedule} defaultDate={addDays(dayKey(new Date()), 1)} defaultTime={time} defaultDuration={[30, 45, 60, 90, 120].includes(duration) ? duration : 60} propertyCode={visit.propertyCode} />
      )}
    </div>
  );
}
