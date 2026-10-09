import Link from "next/link";
import { requireManager } from "@/lib/require";
import { liveBoard, type LiveState } from "@/server/live";
import { fmt } from "@/lib/time";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";
import { relativeTime, TONE_BAR, TONE_TEXT } from "@/lib/visit-tone";
import { Avatar, PageHeader, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { AutoRefresh } from "@/components/auto-refresh";
import { InlineAction } from "@/components/inline-action";
import { nudgeAction } from "@/app/actions/manager";

export const metadata = { title: "Ao vivo" };

const STATE_LABEL: Record<LiveState, string> = {
  done: "Registrada",
  live: "Em andamento",
  awaiting: "Aguardando resultado",
  overdue: "Sem resultado",
  upcoming: "Agendada",
  closed: "Cancelada/remarcada",
};
const SEG: { key: "done" | "live" | "awaiting" | "upcoming"; cls: string; label: string }[] = [
  { key: "done", cls: "bg-good", label: "registradas" },
  { key: "live", cls: "bg-[#2f6fde] dark:bg-[#5b8ff0]", label: "em andamento" },
  { key: "awaiting", cls: "bg-accent", label: "sem resultado" },
  { key: "upcoming", cls: "bg-[#c9d6e6] dark:bg-[#4e6582]", label: "próximas" },
];

export default async function LivePage() {
  const actor = await requireManager();
  const now = new Date();
  const { rows, team } = await liveBoard(actor, now);
  const tiles = [
    { label: "Hoje", value: team.total, detail: `${team.positive} positiva${team.positive === 1 ? "" : "s"}` },
    { label: "Registradas", value: team.done, detail: team.total ? `${Math.round((team.done / team.total) * 100)}% do dia` : "—" },
    { label: "Em andamento", value: team.live, detail: "agora", tone: team.live ? "text-[#2357b3] dark:text-[#93b8ff]" : "" },
    { label: "Sem resultado", value: team.awaiting, detail: team.olderPending ? `+${team.olderPending} de dias anteriores` : "hoje", tone: team.awaiting ? "text-accent-strong" : "" },
    { label: "Próximas", value: team.upcoming, detail: "ainda hoje" },
  ];

  return (
    <>
      <PageHeader
        eyebrow={fmt.longDate(now)}
        title="Hoje ao vivo"
        subtitle={<AutoRefresh seconds={60} />}
        action={
          <Link href="/rota" className="press inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-sm font-semibold shadow-card">
            <Icon name="route" className="size-4" /> Rotas
          </Link>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-2.5 sm:grid-cols-5 sm:gap-3">
        {tiles.map((t, i) => (
          <div key={t.label} className={cx("animate-rise rounded-3xl border border-line bg-surface px-4 py-3.5 shadow-card", i === 0 && "col-span-2 sm:col-span-1")} style={{ animationDelay: `${i * 40}ms` }}>
            <p className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{t.label}</p>
            <p className={cx("num mt-0.5 text-[28px] leading-none font-bold", t.tone)}>{t.value}</p>
            <p className="mt-1 text-[12px] text-ink-3">{t.detail}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-3">Nenhuma consultora ativa.</p>
      ) : (
        <ul className="grid items-start gap-4 lg:grid-cols-2">
          {rows.map((r, i) => {
            const first = r.name.split(" ")[0];
            const status = r.current
              ? { cls: "bg-[#e7effc] text-[#2357b3] dark:bg-[#1f2c44] dark:text-[#93b8ff]", text: `Em visita agora · ${r.current.propertyCode ?? "sem código"} até ${fmt.time(r.current.scheduledEnd)}` }
              : r.awaiting
                ? { cls: "bg-accent-soft text-accent-strong", text: `${r.awaiting} ${r.awaiting === 1 ? "visita" : "visitas"} sem resultado` }
                : r.next
                  ? { cls: "bg-tint text-ink-2", text: `Próxima às ${fmt.time(r.next.scheduledStart)} · ${relativeTime(r.next.scheduledStart, now)}${r.next.property?.neighborhood ? ` · ${r.next.property.neighborhood}` : ""}` }
                  : r.total
                    ? { cls: "bg-good-soft text-good", text: "Dia concluído" }
                    : { cls: "bg-tint text-ink-3", text: "Sem visitas hoje" };
            return (
              <li key={r.id ?? "none"} className="animate-rise overflow-hidden rounded-[26px] border border-line bg-surface shadow-card" style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}>
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={r.name} />
                      <div className="min-w-0">
                        <p className="truncate text-[17px] font-bold tracking-[-0.015em]">{r.name}</p>
                        <p className="text-[13px] text-ink-3">
                          <strong className="num text-ink">{r.done}</strong> de {r.total} registradas
                          {r.positive ? ` · ${r.positive} positiva${r.positive === 1 ? "" : "s"}` : ""}
                          {r.lastConcluded ? ` · último registro ${relativeTime(r.lastConcluded, now)}` : ""}
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className={cx("mt-3 inline-flex rounded-full px-3 py-1 text-[13px] font-semibold", status.cls)}>{status.text}</p>
                  {r.total > 0 && (
                    <div className="mt-4">
                      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-tint" role="img" aria-label={SEG.map((s) => `${r[s.key]} ${s.label}`).join(", ")}>
                        {SEG.map((s) => (r[s.key] ? <span key={s.key} className={cx("h-full transition-[width] duration-700", s.cls)} style={{ width: `${(r[s.key] / r.total) * 100}%` }} /> : null))}
                      </div>
                      <p className="mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
                        {SEG.filter((s) => r[s.key]).map((s) => (
                          <span key={s.key} className="inline-flex items-center gap-1">
                            <span aria-hidden className={cx("size-2 rounded-full", s.cls)} />
                            {r[s.key]} {s.label}
                          </span>
                        ))}
                      </p>
                    </div>
                  )}
                </div>

                {r.visits.length > 0 && (
                  <ol className="border-t border-line">
                    {r.visits.map((v) => (
                      <li key={v.id} className="border-b border-line last:border-b-0">
                        <Link href={`/visitas/${v.id}`} className="relative flex items-center gap-3 py-2.5 pr-5 pl-5 hover:bg-surface-2">
                          <span aria-hidden className={cx("absolute inset-y-0 left-0 w-1", TONE_BAR[v.tone])} />
                          <span className="num w-11 shrink-0 text-[14px] font-bold">{fmt.time(v.scheduledStart)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold">{v.clientName ?? "Cliente sem nome"}</span>
                            <span className="block truncate text-[12px] text-ink-3">
                              {v.propertyCode ?? "sem código"}
                              {v.property?.neighborhood ? ` · ${v.property.neighborhood}` : ""}
                            </span>
                          </span>
                          <span className={cx("shrink-0 text-right text-[12px] font-semibold", TONE_TEXT[v.tone])}>
                            {v.state === "done" ? (v.evaluation ? EVALUATION_LABEL[v.evaluation] : STATUS_LABEL[v.status]) : STATE_LABEL[v.state]}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}

                {r.id && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/50 px-5 py-3">
                    {r.total > 0 && (
                      <Link href={`/rota?consultora=${r.id}`} className="press inline-flex min-h-10 items-center gap-1.5 rounded-full bg-tint px-4 text-[13px] font-semibold">
                        <Icon name="route" className="size-4" /> Rota
                      </Link>
                    )}
                    {r.awaiting + r.olderPending > 0 &&
                      (r.push ? (
                        <InlineAction action={nudgeAction} fields={{ consultantId: r.id }} label={`Cobrar ${first}`} confirm={`Enviar lembrete agora para ${first}?`} />
                      ) : (
                        <span className="text-[12px] text-ink-3">{first} não ativou as notificações</span>
                      ))}
                    {r.olderPending > 0 && <span className="ml-auto text-[12px] font-semibold text-accent-strong">+{r.olderPending} de dias anteriores</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
