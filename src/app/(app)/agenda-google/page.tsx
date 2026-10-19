import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { db } from "@/lib/db";
import { addDays, dayKey, isDayKey, startOfDayInTz } from "@/lib/time";
import { canUseMirror, loadMirror } from "@/server/calendar-mirror";
import { UndoCancel } from "../agenda-do-dia/undo-cancel";
import { CalendarMirror, type View } from "./calendar";

export const metadata = { title: "Agenda Google" };

/** Dia da semana (0 = domingo) de uma data YYYY-MM-DD. */
const dow = (k: string) => new Date(`${k}T12:00:00Z`).getUTCDay();

/** Espelho da agenda Google do pré-atendimento: semana, dia ou mês, como no Google Agenda. */
export default async function AgendaGooglePage({ searchParams }: { searchParams: Promise<{ vista?: string; ref?: string; cancelado?: string; n?: string; g?: string; criada?: string }> }) {
  const actor = await requireActor({ preService: true });
  if (!canUseMirror(actor)) notFound();
  const sp = await searchParams;
  const now = new Date();
  const today = dayKey(now);
  const view: View = sp.vista === "dia" || sp.vista === "mes" ? sp.vista : "semana";
  const ref = isDayKey(sp.ref) ? sp.ref : today;
  // período visível (a semana começa no domingo, como no Google)
  let from: string;
  let count: number;
  if (view === "dia") [from, count] = [ref, 1];
  else if (view === "semana") [from, count] = [addDays(ref, -dow(ref)), 7];
  else {
    const first = `${ref.slice(0, 8)}01`;
    [from, count] = [addDays(first, -dow(first)), 42];
  }
  const days = Array.from({ length: count }, (_, i) => addDays(from, i));
  const [mirror, consultants, reasons] = await Promise.all([
    loadMirror(actor, startOfDayInTz(from), startOfDayInTz(addDays(from, count))),
    db.user.findMany({ where: { role: "CONSULTANT", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.reason.findMany({ where: { kind: "VISIT_CANCEL", active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } }),
  ]);
  const back = `/agenda-google?vista=${view}&ref=${ref}`;
  const undo = sp.cancelado && /^[a-z0-9]{20,40}$/.test(sp.cancelado) ? <UndoCancel key={sp.cancelado} undoId={sp.cancelado} count={Number(sp.n) || 1} google={sp.g ?? ""} back={back} /> : null;
  return (
    <div data-full-bleed>
      <CalendarMirror
        key={`${view}-${from}`}
        view={view}
        refDay={ref}
        today={today}
        days={days}
        now={now.toISOString()}
        mirror={mirror}
        consultants={consultants}
        reasons={reasons}
        back={back}
        banner={undo}
        created={!!sp.criada}
      />
    </div>
  );
}
