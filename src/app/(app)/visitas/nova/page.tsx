import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canCreateManualVisit, canViewVisit, hasGlobalView } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { toLocalInput } from "@/lib/time";
import { NewVisitForm } from "./form";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Visita manual" };

export default async function NewVisitPage({ searchParams }: { searchParams: Promise<{ de?: string }> }) {
  const actor = await requireActor();
  const { de } = await searchParams;
  const settings = await getSettings();
  if (!canCreateManualVisit(actor, settings)) notFound();
  const consultants = hasGlobalView(actor) ? await db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  // Revisita: parte de uma visita anterior do cliente (dados pré-preenchidos).
  const from = de
    ? await db.visit.findUnique({ where: { id: de }, select: { id: true, consultantId: true, clientName: true, phoneRaw: true, propertyCode: true } })
    : null;
  const prefill = from && canViewVisit(actor, from) ? from : null;
  const now = new Date();
  now.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
  return (
    <>
      {prefill ? (
        <PageHeader title="Nova visita do cliente" subtitle={`Revisita de ${prefill.clientName ?? "cliente"}: fica registrada como agendada por você, não pela agenda central.`} />
      ) : (
        <PageHeader title="Visita manual" subtitle="Contingência: use quando a visita não estiver na agenda central." />
      )}
      <NewVisitForm
        consultants={consultants}
        defaultStart={toLocalInput(now)}
        defaults={prefill ? { clientName: prefill.clientName ?? "", phoneRaw: prefill.phoneRaw ?? "", propertyCode: prefill.propertyCode ?? "", consultantId: prefill.consultantId ?? "" } : undefined}
      />
    </>
  );
}
