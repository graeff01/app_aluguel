import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView, visitScope } from "@/lib/authz";
import { listMine, visitListSelect, type VisitListItem } from "@/server/queries";
import { dayKey, fmt } from "@/lib/time";
import { pushConfig } from "@/lib/push";
import { EVALUATION_LABEL, STATUS_LABEL, revisitLabel, scheduledByConsultant } from "@/lib/labels";
import { withRevisits } from "@/server/revisits";
import { cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ContactButtons } from "@/components/contact-buttons";
import { relativeTime, TONE_BAR, TONE_TEXT, visitTone } from "@/lib/visit-tone";
import { PushPrompt } from "@/components/push-toggle";
import { PropertyThumb } from "@/components/property-preview";
import { LockedRegisterButton } from "@/components/locked-register";
import { InstallHint } from "@/components/install-hint";
import { historyWhere } from "@/server/queries";
import { db } from "@/lib/db";

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

const TONE_LABEL = { overdue: "Atrasada", awaiting: "Aguardando resultado", live: "Em andamento", upcoming: "Agendada" } as const;

/** Card da tela única: barra de status colorida + texto; foto do imóvel; ações na base. */
function MineCard({ v, today, now, mode, index, team }: { v: VisitListItem & { note?: string | null }; today: string; now: Date; mode: "awaiting" | "live" | "upcoming" | "done"; index: number; team?: boolean }) {
  const tone = visitTone(v, now);
  const startsSoon = v.scheduledStart.getTime() <= now.getTime() + 15 * 60_000;
  const tappable = true; // futuras também abrem (cancelar/remarcar já disponíveis)
  const rel = mode === "done" ? null : relativeTime(mode === "awaiting" ? v.scheduledEnd : v.scheduledStart, now);
  const hasPhone = !!v.phoneNormalized && mode !== "done";
  const href = `/visitas/${v.id}/registrar`;
  const label = `${mode === "done" ? "Alterar resultado" : mode === "upcoming" && !startsSoon ? "Ver ficha da visita" : "Registrar resultado"}: ${v.clientName ?? "cliente sem nome"}, ${when(v, today)}`;
  const info = (
    <div className="flex gap-4">
      <PropertyThumb photoUrl={v.property?.photoUrl} className="size-[72px]" />
      <div className="min-w-0 flex-1">
        <p className={cx("text-[12px] font-bold tracking-[0.06em] uppercase", TONE_TEXT[tone])}>
          {mode === "done" ? (v.evaluation ? EVALUATION_LABEL[v.evaluation] : STATUS_LABEL[v.status]) : TONE_LABEL[tone as keyof typeof TONE_LABEL]}
        </p>
        <p className="mt-0.5 text-[13px] font-medium text-ink-3">
          {when(v, today)}
          {rel && ` · ${rel}`}
          {team && ` · ${v.consultant?.name.split(" ")[0] ?? "sem consultora"}`}
        </p>
        <p className="mt-1 text-[18px] leading-snug font-bold tracking-[-0.015em] break-words">{v.clientName ?? <span className="text-warn">Cliente sem nome</span>}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-2">
          <Icon name="home" className="size-4 text-ink-3" />
          {v.propertyCode ? <span className="num font-semibold text-ink">{v.propertyCode}</span> : <span className="text-warn">sem código</span>}
        </p>
        {(v.revisit || scheduledByConsultant(v)) && (
          <p className="mt-2 flex flex-wrap gap-1.5 text-[12px] font-semibold">
            {v.revisit && (
              <span className="rounded-full bg-tint px-2 py-0.5 text-ink-2">
                ↺ {revisitLabel(v.revisit)}
                {v.revisit.sameProperty ? " · mesmo imóvel" : ""}
              </span>
            )}
            {scheduledByConsultant(v) && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent-strong">
                Agendada {!team && v.scheduledById === v.consultantId ? "por você" : `por ${v.scheduledBy?.name.split(" ")[0]}`}
              </span>
            )}
          </p>
        )}
        {mode === "done" && v.note && <p className="mt-2 line-clamp-2 text-sm text-ink-3">“{v.note}”</p>}
      </div>
    </div>
  );
  const action =
    mode === "awaiting" || mode === "live" ? (
      <Link href={href} className="press flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-on-primary shadow-[0_6px_16px_-8px_rgb(29_32_35/0.6)] dark:shadow-none">
        Registrar resultado <Icon name="arrow" className="size-4" />
      </Link>
    ) : mode === "upcoming" ? (
      // antes do horário: visível, travado, libera sozinho 15 min antes
      <LockedRegisterButton href={href} unlockAt={new Date(v.scheduledStart.getTime() - 15 * 60_000).toISOString()} unlockLabel={fmt.time(new Date(v.scheduledStart.getTime() - 15 * 60_000))} />
    ) : null;
  return (
    <li className="animate-rise relative overflow-hidden rounded-[26px] border border-line bg-surface shadow-card" style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}>
      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-[5px]", TONE_BAR[tone])} />
      {tappable ? (
        <Link href={href} className={cx("press block pt-5 pr-5 pl-6 active:bg-surface-2", action || hasPhone ? "pb-4" : "pb-5")} aria-label={label}>
          {info}
        </Link>
      ) : (
        <div className={cx("pt-5 pr-5 pl-6", hasPhone ? "pb-4" : "pb-5")}>{info}</div>
      )}
      {(action || hasPhone) && (
        <div className="flex items-center gap-2 pr-5 pb-5 pl-6">
          {action ?? <span className="flex-1" />}
          {hasPhone && <ContactButtons phone={v.phoneNormalized} name={v.clientName} compact />}
        </div>
      )}
    </li>
  );
}

export default async function MinePage({ searchParams }: { searchParams: Promise<{ salvo?: string; busca?: string }> }) {
  const actor = await requireActor();
  const team = hasGlobalView(actor);
  const sp = await searchParams;
  const now = new Date();
  const busca = sp.busca?.trim().slice(0, 80) ?? "";
  const { awaiting, upcoming, done, today } = await listMine(actor, now);
  const results = busca
    ? await withRevisits(await db.visit.findMany({ where: historyWhere(actor, { q: busca }), select: { ...visitListSelect, note: true }, orderBy: { scheduledStart: "desc" }, take: 40 }), visitScope(actor))
    : [];
  const isToday = (d: Date) => dayKey(d) === today;
  const todayDone = done.filter((v) => isToday(v.scheduledStart)).length;
  const todayTotal = todayDone + awaiting.filter((v) => isToday(v.scheduledStart)).length + upcoming.filter((v) => isToday(v.scheduledStart)).length;
  // já começou: conta como "para registrar" (o resultado já pode ser lançado)
  const live = upcoming.filter((v) => v.scheduledStart <= now);
  const future = upcoming.filter((v) => v.scheduledStart > now);
  const toRegister = awaiting.length + live.length;
  const nextToday = future.find((v) => isToday(v.scheduledStart));

  return (
    <div className="mx-auto max-w-xl lg:max-w-none">
      <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase">{fmt.longDate(now)}</p>
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.035em]">
        {team ? "Visitas da equipe" : `${greeting(now)}, ${actor.name.split(" ")[0]}`}
      </h1>
      <p className="mt-1.5 text-[15px] text-ink-2">
        {toRegister === 0
          ? nextToday
            ? `Nada para registrar agora. Próxima às ${fmt.time(nextToday.scheduledStart)}.`
            : "Nada esperando o seu registro."
          : toRegister === 1
            ? "1 visita esperando o seu registro."
            : `${toRegister} visitas esperando o seu registro.`}
      </p>

      <div className="mt-5 lg:mt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
      <aside className="lg:sticky lg:top-24 lg:order-2" aria-label="Resumo do dia">
      {todayTotal > 0 && (
        <div className="mb-4 rounded-[22px] border border-line bg-surface px-5 py-4 shadow-card">
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-sm font-semibold">Hoje</span>
            <span className="num text-sm text-ink-3">
              <strong className="text-[17px] text-ink">{todayDone}</strong> de {todayTotal} registradas
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-tint" role="progressbar" aria-valuemin={0} aria-valuemax={todayTotal} aria-valuenow={todayDone} aria-label="Visitas de hoje registradas">
            <div className="h-full rounded-full bg-good transition-[width] duration-700" style={{ width: `${(todayDone / todayTotal) * 100}%` }} />
          </div>
        </div>
      )}

      {!team && future.some((v) => isToday(v.scheduledStart)) && !busca && (
        <Link href="/rota" className="press animate-rise mb-4 flex items-center justify-between gap-3 rounded-[22px] border border-line bg-surface px-5 py-4 shadow-card">
          <span className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-tint text-ink">
              <Icon name="route" className="size-5" />
            </span>
            <span>
              <span className="block text-[15px] font-semibold">Rota de hoje</span>
              <span className="text-[13px] text-ink-3">
                {future.filter((v) => isToday(v.scheduledStart)).length} {future.filter((v) => isToday(v.scheduledStart)).length === 1 ? "parada" : "paradas"} · abre no Google Maps ou Waze
              </span>
            </span>
          </span>
          <Icon name="arrow" className="size-5 text-ink-3" />
        </Link>
      )}

      <form role="search" className="mb-7 lg:mb-4" action="/minhas">
        <label htmlFor="busca" className="sr-only">
          Buscar visita por nome, telefone ou código
        </label>
        <div className="relative">
          <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            id="busca"
            name="busca"
            type="search"
            defaultValue={busca}
            placeholder="Buscar por nome, telefone ou código"
            className="block min-h-12 w-full rounded-full border border-line-strong bg-surface pr-4 pl-12 text-[15px] shadow-card placeholder:text-ink-3 focus:border-ink focus:outline-none"
          />
        </div>
      </form>

        {!team && done.length > 0 && (
          <div className="mb-4 hidden rounded-[22px] border border-line bg-surface px-5 py-4 shadow-card lg:block">
            <p className="mb-3 text-sm font-semibold">Últimos 7 dias</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "registradas", value: done.length },
                { label: "positivas", value: done.filter((v) => v.evaluation === "POSITIVE").length },
                { label: "não vieram", value: done.filter((v) => v.status === "NO_SHOW").length },
              ].map((t) => (
                <div key={t.label} className="rounded-2xl bg-tint px-2 py-2.5">
                  <p className="num text-[22px] leading-none font-bold">{t.value}</p>
                  <p className="mt-1 text-[11px] text-ink-3">{t.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <Link href="/visitas/nova" className="press mb-4 hidden min-h-12 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface text-[15px] font-semibold shadow-card lg:flex">
          <Icon name="plus" className="size-4" /> Visita fora da agenda
        </Link>
      </aside>
      <div className="min-w-0 lg:order-1">
      {sp.salvo && (
        <div role="status" className="animate-rise mb-5 flex items-center gap-3 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">
          <span aria-hidden className="animate-pop grid size-6 place-items-center rounded-full bg-good text-bg">✓</span>
          Resultado salvo.
        </div>
      )}

      {toRegister === 0 && !busca && (
        <div className="animate-rise mb-9 rounded-[26px] border border-good/15 bg-good-soft px-6 py-8 text-center">
          <span aria-hidden className="animate-pop mx-auto mb-3 grid size-12 place-items-center rounded-full bg-good text-xl text-bg shadow-[0_8px_20px_-8px_var(--good)]">
            ✓
          </span>
          <p className="text-[17px] font-bold text-good">Tudo em dia</p>
          <p className="mt-1 text-sm text-good/80">
            {nextToday ? `Nenhum resultado pendente. Próxima visita às ${fmt.time(nextToday.scheduledStart)}.` : "Nenhuma visita esperando resultado."}
          </p>
        </div>
      )}

      {busca ? (
        <section aria-labelledby="t-busca" className="mb-9">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="t-busca" className="text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">
              {results.length} resultado{results.length === 1 ? "" : "s"} para “{busca}”
            </h2>
            <Link href="/minhas" className="text-sm font-semibold text-ink underline underline-offset-4">
              Limpar
            </Link>
          </div>
          {results.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-line-strong px-5 py-6 text-center text-sm text-ink-3">Nenhuma visita encontrada.</p>
          ) : (
            <ul className="grid gap-3 2xl:grid-cols-2">
              {results.map((v, i) => (
                <MineCard
                  key={v.id}
                  v={v}
                  today={today}
                  now={now}
                  index={i}
                  team={team}
                  mode={v.status !== "SCHEDULED" ? "done" : v.scheduledEnd <= now ? "awaiting" : v.scheduledStart <= now ? "live" : "upcoming"}
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
      <InstallHint />
      <PushPrompt publicKey={pushConfig()?.publicKey ?? null} />

      {toRegister > 0 && (
        <section aria-labelledby="t-aw" className="mb-9">
          <h2 id="t-aw" className="mb-3 text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">
            Para registrar
          </h2>
          <ul className="grid gap-3 2xl:grid-cols-2">
            {awaiting.map((v, i) => (
              <MineCard key={v.id} v={v} today={today} now={now} mode="awaiting" index={i} team={team} />
            ))}
            {live.map((v, i) => (
              <MineCard key={v.id} v={v} today={today} now={now} mode="live" index={awaiting.length + i} team={team} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="t-up" className="mb-9">
        <h2 id="t-up" className="mb-3 text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">
          Próximas
        </h2>
        {future.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line-strong px-5 py-6 text-center text-sm text-ink-3">Nenhuma visita hoje ou amanhã.</p>
        ) : (
          <ul className="grid gap-3 2xl:grid-cols-2">
            {future.map((v, i) => (
              <MineCard key={v.id} v={v} today={today} now={now} mode="upcoming" index={toRegister + i} team={team} />
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
          <ul className="grid gap-3 2xl:grid-cols-2">
            {done.map((v, i) => (
              <MineCard key={v.id} v={v} today={today} now={now} mode="done" index={i} team={team} />
            ))}
          </ul>
        </details>
      )}

        </>
      )}

      </div>
      </div>

      <p className="pb-6 text-center text-sm text-ink-3 lg:hidden">
        Visita fora da agenda?{" "}
        <Link href="/visitas/nova" className="font-semibold text-ink underline underline-offset-4">
          Cadastrar
        </Link>
      </p>
    </div>
  );
}
