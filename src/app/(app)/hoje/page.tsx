import { redirect } from "next/navigation";
import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { listToday } from "@/server/queries";
import { fmt } from "@/lib/time";
import { Empty, LinkButton, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { VisitCard } from "@/components/visit-card";
import { SyncButton } from "@/components/sync-button";

export const metadata = { title: "Hoje" };

function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(now));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default async function TodayPage() {
  const actor = await requireActor();
  if (!hasGlobalView(actor)) redirect("/minhas");
  const now = new Date();
  const { visits, previousPending, oldestPending } = await listToday(actor, now);
  const global = hasGlobalView(actor);
  const awaiting = visits.filter((v) => v.status === "SCHEDULED" && v.scheduledEnd <= now && !v.excluded).length;
  const done = visits.filter((v) => v.status !== "SCHEDULED").length;
  const upcoming = visits.filter((v) => v.status === "SCHEDULED" && v.scheduledEnd > now).length;
  return (
    <>
      <PageHeader
        eyebrow={fmt.longDate(now)}
        title={global ? "Visitas de hoje" : `${greeting(now)}, ${actor.name.split(" ")[0]}`}
        action={
          <div className="flex gap-2">
            {global && <SyncButton />}
            <LinkButton href="/visitas/nova" variant="secondary">
              <Icon name="plus" className="size-4" /> Visita manual
            </LinkButton>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-3 gap-2.5 sm:gap-4">
        {[
          { label: "Hoje", value: visits.length, tone: "" },
          { label: "Aguardando", value: awaiting, tone: awaiting ? "text-accent-strong" : "" },
          { label: "Registradas", value: done, tone: "" },
        ].map((s) => (
          <div key={s.label} className="rounded-3xl border border-line bg-surface px-4 py-3.5 shadow-card">
            <p className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{s.label}</p>
            <p className={`num mt-0.5 text-[28px] leading-none font-bold ${s.tone}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {previousPending > 0 && (
        <Link
          href="/pendencias"
          className="mb-6 flex items-center justify-between gap-3 rounded-3xl bg-primary px-5 py-4 text-white shadow-float transition hover:bg-[#33373b]"
        >
          <span className="flex items-center gap-3">
            <span className="num grid size-10 shrink-0 place-items-center rounded-full bg-accent text-[15px] font-bold">{previousPending}</span>
            <span>
              <span className="block font-semibold">
                {previousPending === 1 ? "Visita anterior aguardando resultado" : "Visitas anteriores aguardando resultado"}
              </span>
              {oldestPending && <span className="text-sm text-white/60">A mais antiga é de {fmt.date(oldestPending)}</span>}
            </span>
          </span>
          <Icon name="arrow" className="size-5 shrink-0 text-white/70" />
        </Link>
      )}

      {visits.length === 0 ? (
        <Empty title="Nenhuma visita hoje" icon="☼">
          As visitas da agenda aparecem aqui automaticamente. Se faltar alguma, use “Visita manual”.
        </Empty>
      ) : (
        <>
          {upcoming > 0 && awaiting + done > 0 && <p className="sr-only">{upcoming} visitas ainda vão acontecer.</p>}
          <ul className="space-y-3">
            {visits.map((v) => (
              <VisitCard key={v.id} v={v} now={now} showConsultant={global} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
