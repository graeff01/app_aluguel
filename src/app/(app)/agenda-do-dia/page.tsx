import { redirect } from "next/navigation";
import { requireActor } from "@/lib/require";
import { hasGlobalView, isPreService } from "@/lib/authz";
import { dayAgenda } from "@/server/day-agenda";
import { addDays, dayKey, fmt, isDayKey } from "@/lib/time";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";
import { PageHeader, Segmented, cx } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { db } from "@/lib/db";
import { CancelVisit } from "./cancel";

export const metadata = { title: "Agenda do dia" };

export default async function DayAgendaPage({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  const actor = await requireActor({ preService: true });
  if (!isPreService(actor) && !hasGlobalView(actor)) redirect("/minhas");
  const sp = await searchParams;
  const now = new Date();
  const today = dayKey(now);
  const tomorrow = addDays(today, 1);
  const day = isDayKey(sp.dia) ? sp.dia : today;
  const [a, cancelReasons] = await Promise.all([
    dayAgenda(actor, day),
    db.reason.findMany({ where: { kind: "VISIT_CANCEL", active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } }),
  ]);
  const label = (v: (typeof a.groups)[number]["items"][number]) => {
    if (v.status !== "SCHEDULED") return v.evaluation ? EVALUATION_LABEL[v.evaluation] : STATUS_LABEL[v.status];
    if (v.scheduledStart <= now && v.scheduledEnd > now) return "Em andamento";
    if (v.scheduledEnd <= now) return "Aguardando resultado";
    return "Agendada";
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={fmt.longDate(new Date(day + "T15:00:00Z"))} title={day === today ? "Visitas de hoje" : day === tomorrow ? "Visitas de amanhã" : "Visitas do dia"} subtitle={<AutoRefresh seconds={60} />} />
      <div className="mb-5">
        <Segmented
          label="Dia"
          items={[
            { href: "/agenda-do-dia", label: "Hoje", active: day === today },
            { href: `/agenda-do-dia?dia=${tomorrow}`, label: "Amanhã", active: day === tomorrow },
          ]}
        />
      </div>
      {a.unassigned > 0 && (
        <p role="alert" className="mb-5 rounded-2xl border border-bad/20 bg-bad-soft px-4 py-3 text-sm font-semibold text-bad">
          {a.unassigned === 1 ? "1 visita está sem consultora" : `${a.unassigned} visitas estão sem consultora`}: convide a consultora no evento da agenda Google.
        </p>
      )}
      {a.visits === 0 ? (
        <p className="rounded-3xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-3">Nenhuma visita neste dia.</p>
      ) : (
        <div className="space-y-5">
          {a.groups.map((g) => (
            <section key={g.id ?? "none"} className={cx("overflow-hidden rounded-[26px] border bg-surface shadow-card", g.id ? "border-line" : "border-bad/30")}>
              <h2 className={cx("border-b px-5 py-3 text-[15px] font-bold", g.id ? "border-line" : "border-bad/20 bg-bad-soft text-bad")}>
                {g.name} <span className="font-medium text-ink-3">· {g.items.length}</span>
              </h2>
              <ol>
                {g.items.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-2.5 last:border-b-0">
                    <span className="num w-12 shrink-0 text-[14px] font-bold">{fmt.time(v.scheduledStart)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{v.clientName ?? "Cliente sem nome"}</span>
                      <span className="block truncate text-[12px] text-ink-3">
                        {v.propertyCode ?? "sem código"}
                        {v.property?.neighborhood ? ` · ${v.property.neighborhood}` : ""}
                        {v.rescheduledFromId && v.assignmentNote === "REAGENDADA" ? " · ↻ remarcada" : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5 text-right text-[12px] font-semibold">
                      <span className="text-ink-2">{label(v)}</span>
                      {v.status === "SCHEDULED" && v.confirmStatus === "CONFIRMED" && <span className="text-good">✓ confirmada</span>}
                      {v.status === "SCHEDULED" && v.confirmStatus === "NO_REPLY" && <span className="text-warn">sem resposta</span>}
                      {v.status === "CANCELED" && v.cancelReason && <span className="font-normal text-ink-3">{v.cancelReason.label}</span>}
                    </span>
                    {v.status === "SCHEDULED" && !v.companionOfId && v.scheduledEnd > now && (
                      <span className="basis-full sm:basis-auto">
                        <CancelVisit visitId={v.id} label={`${fmt.time(v.scheduledStart)} · ${v.clientName ?? "cliente"}`} reasons={cancelReasons} />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
