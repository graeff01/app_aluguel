import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canCreateManualVisit, hasGlobalView } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { toLocalInput } from "@/lib/time";
import { NewVisitForm } from "./form";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Visita manual" };

export default async function NewVisitPage() {
  const actor = await requireActor();
  const settings = await getSettings();
  if (!canCreateManualVisit(actor, settings)) notFound();
  const consultants = hasGlobalView(actor) ? await db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const now = new Date();
  now.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
  return (
    <>
      <PageHeader title="Visita manual" subtitle="Contingência: use quando a visita não estiver na agenda central." />
      <NewVisitForm consultants={consultants} defaultStart={toLocalInput(now)} />
    </>
  );
}
