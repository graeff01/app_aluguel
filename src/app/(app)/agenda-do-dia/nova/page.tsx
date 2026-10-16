import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { hasGlobalView, isPreService } from "@/lib/authz";
import { db } from "@/lib/db";
import { dayKey, endOfDayInTz, startOfDayInTz } from "@/lib/time";
import { isAway } from "@/server/pre-analysis";
import { PageHeader } from "@/components/ui";
import { StaffVisitForm } from "./form";

export const metadata = { title: "Nova visita" };

export default async function NewStaffVisitPage() {
  const actor = await requireActor({ preService: true });
  if (!isPreService(actor) && !hasGlobalView(actor)) notFound();
  const today = dayKey(new Date());
  const consultants = await db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true, awayUntil: true }, orderBy: { name: "asc" } });
  const counts = await db.visit.groupBy({ by: ["consultantId"], where: { excluded: false, status: "SCHEDULED", scheduledStart: { gte: startOfDayInTz(today), lt: endOfDayInTz(today) } }, _count: { _all: true } });
  const byId = new Map(counts.map((c) => [c.consultantId, c._count._all]));
  return (
    <>
      <Link href="/agenda-do-dia" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Visitas
      </Link>
      <PageHeader title="Nova visita" subtitle="O app cria a visita e o evento na agenda Google já no padrão, com a consultora convidada." />
      <StaffVisitForm
        today={today}
        consultants={consultants.map((c) => ({ id: c.id, name: c.name, away: isAway(c.awayUntil) ? c.awayUntil!.toISOString().slice(0, 10).split("-").reverse().slice(0, 2).join("/") : null, today: byId.get(c.id) ?? 0 }))}
      />
    </>
  );
}
