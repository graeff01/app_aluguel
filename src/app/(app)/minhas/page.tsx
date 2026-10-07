import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { listMine, type VisitListItem } from "@/server/queries";
import { dayKey, fmt } from "@/lib/time";
import { pushConfig } from "@/lib/push";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";
import { Badge, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ContactButtons } from "@/components/contact-buttons";
import { PushPrompt } from "@/components/push-toggle";

export const metadata = { title: "Minhas visitas" };

function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(now));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function when(v: VisitListItem, today: string) {
  const k = dayKey(v.scheduledStart);
  const label = k === today ? "Hoje" : fmt.shortDate(v.scheduledStart).replace(".", "");
  return `${label} · ${fmt.time(v.scheduledStart)}`;
}

/** Card da tela única: o card inteiro é o toque principal. */
function MineCard({ v, today, now, mode }: { v: VisitListItem & { note?: string | null }; today: string; now: Date; mode: "awaiting" | "upcoming" | "done" }) {
  const startsSoon = v.scheduledStart.getTime() <= now.getTime() + 15 * 60_000;
  const tappable = mode !== "upcoming" || startsSoon;
  const overdue = mode === "awaiting" && now.getTime() - v.scheduledEnd.getTime() > 24 * 3600_000;
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className={cx("min-w-0", v.phoneNormalized && mode !== "done" && "pr-24")}>
          <p className={cx("text-[13px] font-semibold", mode === "awaiting" ? "text-accent-strong" : "text-ink-3")}>
            {when(v, today)}
            {overdue && " · há mais de 24 h"}
          </p>
          <p className="mt-0.5 text-[18px] leading-snug font-bold tracking-[-0.01em] break-words">{v.clientName ?? <span className="text-warn">Cliente sem nome</span>}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-2">
            <Icon name="home" className="size-4 text-ink-3" />
            {v.propertyCode ? <span className="num font-semibold text-ink">{v.propertyCode}</span> : <span className="text-warn">sem código</span>}
          </p>
        </div>
        {mode === "done" && (
          <Badge tone={v.evaluation === "POSITIVE" ? "good" : v.evaluation === "NEGATIVE" ? "bad" : "neutral"} dot={!!v.evaluation}>
            {v.evaluation ? EVALUATION_LABEL[v.evaluation] : STATUS_LABEL[v.status]}
          </Badge>
        )}
      </div>
      {mode === "awaiting" && (
        <span className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-white">
          Registrar resultado <Icon name="arrow" className="size-4" />
        </span>
      )}
      {mode === "upcoming" && startsSoon && (
        <span className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-full border border-line-strong text-[15px] font-semibold">
          Visita em andamento · registrar <Icon name="arrow" className="size-4" />
        </span>
      )}
      {mode === "done" && v.note && <p className="mt-2 line-clamp-2 text-sm text-ink-3">{v.note}</p>}
    </>
  );
  return (
    <li className={cx("relative overflow-hidden rounded-3xl border bg-surface shadow-card", mode === "awaiting" ? "border-accent/30" : "border-line")}>
      {mode === "awaiting" && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent" />}
      {tappable ? (
        <Link href={`/visitas/${v.id}/registrar`} className="block p-5 active:bg-surface-2" aria-label={`${mode === "done" ? "Alterar resultado" : "Registrar resultado"}: ${v.clientName ?? "cliente sem nome"}, ${when(v, today)}`}>
          {inner}
        </Link>
      ) : (
        <div className="p-5">{inner}</div>
      )}
      {v.phoneNormalized && mode !== "done" && (
        <div className="absolute top-4 right-4">
          <ContactButtons phone={v.phoneNormalized} name={v.clientName} compact />
        </div>
      )}
    </li>
  );
}

export default async function MinePage({ searchParams }: { searchParams: Promise<{ salvo?: string }> }) {
  const actor = await requireActor();
  if (hasGlobalView(actor)) redirect("/hoje");
  const sp = await searchParams;
  const now = new Date();
  const { awaiting, upcoming, done, today } = await listMine(actor, now);

  return (
    <div className="mx-auto max-w-xl">
      <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase">{fmt.longDate(now)}</p>
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.035em]">
        {greeting(now)}, {actor.name.split(" ")[0]}
      </h1>
      <p className="mt-1.5 mb-6 text-[15px] text-ink-2">
        {awaiting.length === 0
          ? "Nenhuma visita esperando resultado."
          : awaiting.length === 1
            ? "1 visita esperando o seu registro."
            : `${awaiting.length} visitas esperando o seu registro.`}
      </p>

      {sp.salvo && (
        <div role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">
          ✓ Resultado salvo.
        </div>
      )}

      <PushPrompt publicKey={pushConfig()?.publicKey ?? null} />

      {awaiting.length > 0 && (
        <section aria-labelledby="t-aw" className="mb-9">
          <h2 id="t-aw" className="mb-3 text-[13px] font-bold tracking-[0.1em] text-ink-3 uppercase">
            Para registrar
          </h2>
          <ul className="space-y-3">
            {awaiting.map((v) => (
              <MineCard key={v.id} v={v} today={today} now={now} mode="awaiting" />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="t-up" className="mb-9">
        <h2 id="t-up" className="mb-3 text-[13px] font-bold tracking-[0.1em] text-ink-3 uppercase">
          Próximas
        </h2>
        {upcoming.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line-strong px-5 py-6 text-center text-sm text-ink-3">Nenhuma visita hoje ou amanhã.</p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((v) => (
              <MineCard key={v.id} v={v} today={today} now={now} mode="upcoming" />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <details className="group mb-9">
          <summary className="mb-3 flex min-h-11 cursor-pointer items-center justify-between text-[13px] font-bold tracking-[0.1em] text-ink-3 uppercase">
            Registradas nos últimos 7 dias ({done.length})
            <span aria-hidden className="text-lg transition-transform group-open:rotate-45">+</span>
          </summary>
          <ul className="space-y-3">
            {done.map((v) => (
              <MineCard key={v.id} v={v} today={today} now={now} mode="done" />
            ))}
          </ul>
        </details>
      )}

      <p className="pb-6 text-center text-sm text-ink-3">
        Visita fora da agenda?{" "}
        <Link href="/visitas/nova" className="font-semibold text-ink underline underline-offset-4">
          Cadastrar
        </Link>
      </p>
    </div>
  );
}
