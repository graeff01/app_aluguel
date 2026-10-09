import Link from "next/link";
import { fmt, dayKey } from "@/lib/time";
import { LinkButton, Badge, cx } from "./ui";
import { Icon } from "./icons";
import { VisitStatusBadge } from "./visit-badges";
import { ContactButtons } from "./contact-buttons";
import { TONE_BAR, visitTone } from "@/lib/visit-tone";
import type { VisitListItem } from "@/server/queries";
import { revisitLabel, scheduledByConsultant } from "@/lib/labels";

export function VisitCard({ v, now = new Date(), showConsultant, showDate }: { v: VisitListItem; now?: Date; showConsultant?: boolean; showDate?: boolean }) {
  const started = v.scheduledStart.getTime() <= now.getTime() + 15 * 60_000;
  const canRegister = v.status === "SCHEDULED" && !v.excluded && v.consultantId !== null;
  const awaiting = v.status === "SCHEDULED" && v.scheduledEnd <= now && !v.excluded;
  const overdue24 = awaiting && now.getTime() - v.scheduledEnd.getTime() > 24 * 3600_000;
  const otherDay = showDate || dayKey(v.scheduledStart) !== dayKey(now);
  const byConsultant = scheduledByConsultant(v);
  return (
    <li className="animate-rise group relative overflow-hidden rounded-[26px] border border-line bg-surface shadow-card transition-shadow hover:shadow-float">
      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-[5px]", TONE_BAR[visitTone(v, now)])} />
      <div className="flex gap-4 py-4 pr-4 pl-5 sm:py-5 sm:pr-5 sm:pl-6">
        <div className="w-16 shrink-0 border-r border-line pr-4 text-right">
          {otherDay && <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{fmt.shortDate(v.scheduledStart).replace(".", "")}</p>}
          <p className="num text-[19px] leading-tight font-bold">{fmt.time(v.scheduledStart)}</p>
          <p className="num text-[13px] text-ink-3">{fmt.time(v.scheduledEnd)}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <Link href={`/visitas/${v.id}`} className="min-w-0 text-[17px] leading-snug font-bold tracking-[-0.01em] break-words after:absolute after:inset-0 after:content-['']">
              {v.clientName ?? <span className="text-warn">Cliente sem nome</span>}
            </Link>
            <VisitStatusBadge v={v} now={now} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="home" className="size-4 text-ink-3" />
              {v.propertyCode ? <span className="num font-semibold text-ink">{v.propertyCode}</span> : <span className="text-warn">sem código</span>}
            </span>
            {showConsultant && <span>{v.consultant?.name ?? <span className="text-warn">sem consultora</span>}</span>}
            {overdue24 && <span className="font-semibold text-accent-strong">há mais de 24 h</span>}
          </div>
          {(v.syncConflict !== "NONE" || v.assignmentStatus === "NEEDS_REVIEW" || v.revisit || byConsultant) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {v.revisit && (
                <Badge tone="info">
                  Revisita · {revisitLabel(v.revisit).replace("Cliente já visitou ", "já visitou ")}
                  {v.revisit.sameProperty ? " (mesmo imóvel)" : ""}
                </Badge>
              )}
              {byConsultant && <Badge tone="accent">Agendada pela consultora{v.scheduledBy && v.scheduledBy.id !== v.consultantId ? ` (${v.scheduledBy.name.split(" ")[0]})` : ""}</Badge>}
              {v.syncConflict !== "NONE" && <Badge tone="warn">Conflito com a agenda</Badge>}
              {v.assignmentStatus === "NEEDS_REVIEW" && <Badge tone="warn">Atribuição em revisão</Badge>}
            </div>
          )}
          {(canRegister && started) || v.phoneNormalized ? (
            <div className="mt-4 flex items-center gap-2">
              {canRegister && started && (
                <LinkButton href={`/visitas/${v.id}/registrar`} className="relative z-[1] flex-1 sm:flex-none">
                  Registrar resultado
                  <Icon name="arrow" className="size-4" />
                </LinkButton>
              )}
              <ContactButtons phone={v.phoneNormalized} name={v.clientName} compact />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
