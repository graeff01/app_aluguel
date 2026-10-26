import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/require";
import { hasGlobalView, isPreService } from "@/lib/authz";
import { dayAgenda, rangeAgenda } from "@/server/day-agenda";
import { addDays, dayKey, fmt, isDayKey } from "@/lib/time";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";
import { PageHeader, Segmented, cx } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { db } from "@/lib/db";
import { CancelReason, CancelVisit, ReopenVisit } from "./cancel";
import { UndoCancel } from "./undo-cancel";
import { calendarLinkFor } from "@/server/reschedule";
import { LinkButton } from "@/components/ui";

export const metadata = { title: "Agenda" };

type Row = {
  id: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  clientName: string | null;
  propertyCode: string | null;
  status: string;
  evaluation: string | null;
  confirmStatus: string | null;
  assignmentNote: string | null;
  rescheduledFromId: string | null;
  companionOfId: string | null;
  cancelReason: { label: string } | null;
  note: string | null;
  autoCanceled: boolean;
  concludedBy: { name: string } | null;
  consultant?: { name: string } | null;
  property: { neighborhood: string | null } | null;
};

const mondayOf = (k: string) => {
  const d = new Date(`${k}T12:00:00Z`);
  return addDays(k, -((d.getUTCDay() + 6) % 7));
};
const monthOf = (k: string) => `${k.slice(0, 7)}-01`;
const nextMonth = (k: string) => {
  const [y, m] = k.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};
const prevMonth = (k: string) => {
  const [y, m] = k.split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
};
const dayTitle = (k: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`));
const monthTitle = (k: string) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`));

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ dia?: string; vista?: string; ref?: string; cancelado?: string; n?: string; g?: string; criada?: string }> }) {
  const actor = await requireActor({ preService: true });
  if (!isPreService(actor) && !hasGlobalView(actor)) redirect("/minhas");
  const sp = await searchParams;
  const now = new Date();
  const today = dayKey(now);
  const tomorrow = addDays(today, 1);
  const view = sp.vista === "semana" || sp.vista === "mes" ? sp.vista : "dia";
  const ref = isDayKey(sp.ref) ? sp.ref : today;
  const cancelReasons = await db.reason.findMany({ where: { kind: "VISIT_CANCEL", active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } });

  // endereço da tela atual (sem os dados do último cancelamento): o cancelamento volta para cá
  const keep = new URLSearchParams(Object.entries({ dia: sp.dia, vista: sp.vista, ref: sp.ref }).filter((e): e is [string, string] => !!e[1]));
  const back = `/agenda-do-dia${keep.size ? `?${keep}` : ""}`;
  const undo = sp.cancelado && /^[a-z0-9]{20,40}$/.test(sp.cancelado) ? <UndoCancel key={sp.cancelado} undoId={sp.cancelado} count={Number(sp.n) || 1} google={sp.g ?? ""} back={back} /> : null;
  // acabou de agendar pelo app: confirmação (e o botão do Google, se o app não conseguiu criar o evento)
  let created: React.ReactNode = null;
  if (sp.criada && /^[a-z0-9]{20,40}$/.test(sp.criada)) {
    const nv = await db.visit.findUnique({ where: { id: sp.criada }, select: { id: true, scheduledStart: true, googleCreatedAt: true, consultant: { select: { name: true } } } });
    if (nv) {
      const link = nv.googleCreatedAt ? null : await calendarLinkFor(actor, nv.id).catch(() => null);
      created = (
        <div role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-[14px] text-good">
          <p className="font-semibold">
            ✓ Visita criada para {nv.consultant?.name.split(" ")[0] ?? "a consultora"} · {fmt.shortDate(nv.scheduledStart)} às {fmt.time(nv.scheduledStart)}.
            {nv.googleCreatedAt ? " Evento criado na agenda Google e convite enviado." : ""}
          </p>
          {link && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-ink-2">
              {sp.g === "error" ? "Não consegui criar o evento no Google agora." : "O app ainda não tem permissão para criar na agenda."}
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-10 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary">
                Colocar na agenda Google
              </a>
            </p>
          )}
        </div>
      );
    }
  }
  const status = (v: Row) => {
    if (v.status !== "SCHEDULED") return v.evaluation ? EVALUATION_LABEL[v.evaluation] : STATUS_LABEL[v.status];
    if (v.scheduledStart <= now && v.scheduledEnd > now) return "Em andamento";
    if (v.scheduledEnd <= now) return "Aguardando resultado";
    return "Agendada";
  };
  // mesma visita com vários imóveis: códigos ainda em aberto de cada visita
  const openCodes = new Map<string, { id: string; code: string | null }[]>();
  const track = (list: Row[]) => {
    for (const v of list) if (v.status === "SCHEDULED") openCodes.set(v.companionOfId ?? v.id, [...(openCodes.get(v.companionOfId ?? v.id) ?? []), { id: v.id, code: v.propertyCode }]);
  };
  const row = (v: Row, showConsultant: boolean) => (
    <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-2.5 last:border-b-0">
      <span className="num w-12 shrink-0 text-[14px] font-bold">{fmt.time(v.scheduledStart)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{v.clientName ?? "Cliente sem nome"}</span>
        <span className="block truncate text-[12px] text-ink-3">
          {showConsultant && <span className={cx("font-semibold", v.consultant ? "text-ink-2" : "text-bad")}>{v.consultant?.name.split(" ")[0] ?? "Sem consultora"} · </span>}
          {v.propertyCode ?? "sem código"}
          {v.property?.neighborhood ? ` · ${v.property.neighborhood}` : ""}
          {v.rescheduledFromId && v.assignmentNote === "REAGENDADA" ? " · ↻ remarcada" : ""}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right text-[12px] font-semibold">
        <span className={v.status === "CANCELED" ? "text-bad" : "text-ink-2"}>{status(v)}</span>
        {v.status === "SCHEDULED" && v.confirmStatus === "CONFIRMED" && <span className="text-good">✓ confirmada</span>}
        {v.status === "SCHEDULED" && v.confirmStatus === "NO_REPLY" && <span className="text-warn">sem resposta</span>}
        {v.status === "CANCELED" && v.cancelReason && <span className="font-normal text-ink-3">{v.cancelReason.label}</span>}
      </span>
      {v.status === "CANCELED" && (
        <span className="basis-full text-[12px] text-ink-3">
          {/* quem cancelou: pela agenda Google (sincronização) ou alguém no app */}
          Cancelada {v.concludedBy ? `por ${v.concludedBy.name.split(" ")[0]}` : v.autoCanceled ? "pela agenda Google" : ""}
          {v.note && v.note !== v.cancelReason?.label ? `: ${v.note}` : ""}
        </span>
      )}
      {v.status === "CANCELED" && !v.cancelReason && (
        <span className="basis-full sm:basis-auto">
          <CancelReason visitId={v.id} reasons={cancelReasons} />
        </span>
      )}
      {v.status === "CANCELED" && !v.autoCanceled && (
        <span className="basis-full sm:basis-auto">
          <ReopenVisit visitId={v.id} code={v.propertyCode} />
        </span>
      )}
      {v.status === "SCHEDULED" && v.scheduledEnd > now && (
        <span className="basis-full sm:basis-auto">
          <CancelVisit
            visitId={v.id}
            code={v.propertyCode}
            others={(openCodes.get(v.companionOfId ?? v.id) ?? []).filter((x) => x.id !== v.id).map((x) => x.code ?? "sem código")}
            label={`${fmt.shortDate(v.scheduledStart)} ${fmt.time(v.scheduledStart)} · ${v.clientName ?? "cliente"}`}
            reasons={cancelReasons}
            back={back}
          />
        </span>
      )}
    </li>
  );

  const tabs = (
    <div className="mb-5">
      <Segmented
        label="Período"
        items={[
          { href: "/agenda-do-dia", label: "Hoje", active: view === "dia" && (sp.dia ?? today) === today },
          { href: `/agenda-do-dia?dia=${tomorrow}`, label: "Amanhã", active: view === "dia" && sp.dia === tomorrow },
          { href: "/agenda-do-dia?vista=semana", label: "Semana", active: view === "semana" },
          { href: "/agenda-do-dia?vista=mes", label: "Mês", active: view === "mes" },
        ]}
      />
    </div>
  );

  if (view === "dia") {
    const day = isDayKey(sp.dia) ? sp.dia : today;
    const a = await dayAgenda(actor, day);
    track(a.groups.flatMap((g) => g.items));
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow={fmt.longDate(new Date(day + "T15:00:00Z"))} title={day === today ? "Visitas de hoje" : day === tomorrow ? "Visitas de amanhã" : "Visitas do dia"} subtitle={<AutoRefresh seconds={60} />} action={<LinkButton href="/agenda-do-dia/nova">+ Nova visita</LinkButton>} />
        {tabs}
        {created}
        {undo}
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
                <ol>{g.items.map((v) => row(v, false))}</ol>
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  // semana (segunda a domingo) ou mês
  const from = view === "semana" ? mondayOf(ref) : monthOf(ref);
  const to = view === "semana" ? addDays(from, 7) : nextMonth(from);
  const prev = view === "semana" ? addDays(from, -7) : prevMonth(from);
  const isCurrent = view === "semana" ? from === mondayOf(today) : from === monthOf(today);
  const a = await rangeAgenda(actor, from, to);
  track(a.days.flatMap((d) => d.items));
  const title = view === "semana" ? `Semana de ${from.slice(8, 10)}/${from.slice(5, 7)} a ${addDays(to, -1).slice(8, 10)}/${addDays(to, -1).slice(5, 7)}` : monthTitle(from).replace(/^./, (c) => c.toUpperCase());
  const nav = (href: string, label: string, aria: string) => (
    <Link href={href} aria-label={aria} className="press inline-flex min-h-10 items-center rounded-full border border-line-strong px-3.5 text-[14px] font-semibold">
      {label}
    </Link>
  );
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={view === "semana" ? "Visitas da semana" : "Visitas do mês"} title={title} subtitle={<AutoRefresh seconds={60} />} action={<LinkButton href="/agenda-do-dia/nova">+ Nova visita</LinkButton>} />
      {tabs}
      {created}
      {undo}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {nav(`/agenda-do-dia?vista=${view}&ref=${prev}`, "←", view === "semana" ? "Semana anterior" : "Mês anterior")}
        {!isCurrent && nav(`/agenda-do-dia?vista=${view}`, view === "semana" ? "Esta semana" : "Este mês", "Voltar ao período atual")}
        {nav(`/agenda-do-dia?vista=${view}&ref=${to}`, "→", view === "semana" ? "Próxima semana" : "Próximo mês")}
      </div>
      <div className="mb-5 flex flex-wrap gap-2 text-[13px]">
        <span className="rounded-full bg-tint px-3 py-1 font-semibold">{a.total - a.canceled} visita{a.total - a.canceled === 1 ? "" : "s"}</span>
        {a.byConsultant.map(([name, n]) => (
          <span key={name} className="rounded-full bg-tint px-3 py-1 text-ink-2">
            {name.split(" ")[0]}: {n}
          </span>
        ))}
        {a.canceled > 0 && <span className="rounded-full bg-bad-soft px-3 py-1 font-semibold text-bad">{a.canceled} cancelada{a.canceled > 1 ? "s" : ""}</span>}
      </div>
      {a.unassigned > 0 && (
        <p role="alert" className="mb-5 rounded-2xl border border-bad/20 bg-bad-soft px-4 py-3 text-sm font-semibold text-bad">
          {a.unassigned === 1 ? "1 visita está sem consultora" : `${a.unassigned} visitas estão sem consultora`}: convide a consultora no evento da agenda Google.
        </p>
      )}
      {a.days.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-3">Nenhuma visita neste período.</p>
      ) : (
        <div className="space-y-5">
          {a.days.map((d) => (
            <section key={d.day} className={cx("overflow-hidden rounded-[26px] border bg-surface shadow-card", d.day === today ? "border-accent/40" : "border-line")}>
              <h2 className="flex items-center justify-between border-b border-line px-5 py-3 text-[15px] font-bold capitalize">
                <span>
                  {dayTitle(d.day)}
                  {d.day === today && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-white normal-case">hoje</span>}
                </span>
                <span className="font-medium text-ink-3 normal-case">{d.items.length}</span>
              </h2>
              <ol>{d.items.map((v) => row(v, true))}</ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
