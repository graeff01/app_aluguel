import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { hasGlobalView, isPreService } from "@/lib/authz";
import { db } from "@/lib/db";
import { dayKey, toLocalInput } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import { StaffEditForm } from "./form";

export const metadata = { title: "Editar visita" };

export default async function EditStaffVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor({ preService: true });
  if (!isPreService(actor) && !hasGlobalView(actor)) notFound();
  const { id } = await params;
  const v = await db.visit.findUnique({ where: { id } });
  if (!v || v.excluded) notFound();
  const groupId = v.companionOfId ?? v.id;
  const group = await db.visit.findMany({ where: { excluded: false, status: "SCHEDULED", OR: [{ id: groupId }, { companionOfId: groupId }] }, select: { propertyCode: true }, orderBy: { createdAt: "asc" } });
  const consultants = await db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const back = `/agenda-do-dia?dia=${dayKey(v.scheduledStart)}`;
  const local = toLocalInput(v.scheduledStart);
  return (
    <>
      <Link href={back} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Visitas do dia
      </Link>
      <PageHeader title="Editar visita" subtitle="Vale para todos os imóveis da visita. O evento na agenda Google é atualizado junto e a consultora é avisada." />
      {v.status !== "SCHEDULED" ? (
        <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn">Esta visita já tem resultado registrado: não dá para editar.</p>
      ) : (
        <StaffEditForm
          visit={{
            id: v.id,
            version: v.version,
            clientName: v.clientName ?? "",
            externalRef: v.externalRef ?? "",
            phoneRaw: v.phoneRaw ?? "",
            date: local.slice(0, 10),
            time: local.slice(11, 16),
            duration: String(Math.max(15, Math.round((v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60_000))),
            consultantId: v.consultantId ?? "",
            codes: group.map((g) => g.propertyCode ?? "sem código"),
          }}
          consultants={consultants}
          today={dayKey(new Date())}
        />
      )}
    </>
  );
}
