import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { dayRoute } from "@/server/route";
import { canEditPropertyAddress } from "@/server/route";
import { addDays, dayKey, fmt, isDayKey } from "@/lib/time";
import { mapsPlaceUrl, wazeUrl } from "@/lib/address";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";
import { relativeTime, TONE_BAR, TONE_TEXT, visitTone } from "@/lib/visit-tone";
import { cx, Segmented } from "@/components/ui";
import { Icon } from "@/components/icons";
import { PropertyThumb } from "@/components/property-preview";
import { AddressEditor } from "@/components/address-editor";
import { RouteMapLazy } from "@/components/route-map-lazy";
import type { MapStop } from "@/components/route-map";
import { ensurePropertyCoords } from "@/server/geo";
import { db } from "@/lib/db";
import { endOfDayInTz, startOfDayInTz } from "@/lib/time";
import { log } from "@/lib/log";

export const metadata = { title: "Rota do dia" };

const TONE_LABEL: Record<string, string> = { overdue: "Sem resultado", awaiting: "Aguardando resultado", live: "Em andamento", upcoming: "Agendada" };

function gapText(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export default async function RoutePage({ searchParams }: { searchParams: Promise<{ dia?: string; consultora?: string }> }) {
  const actor = await requireActor();
  const global = hasGlobalView(actor);
  const sp = await searchParams;
  const now = new Date();
  const today = dayKey(now);
  const tomorrow = addDays(today, 1);
  const day = isDayKey(sp.dia) ? sp.dia : today;
  // coordenadas que faltarem (poucas por vez; o worker adianta as próximas visitas)
  const codes = await db.visit.findMany({
    where: { ...(global ? (sp.consultora ? { consultantId: sp.consultora } : {}) : { consultantId: actor.id }), excluded: false, propertyCode: { not: null }, scheduledStart: { gte: startOfDayInTz(day), lt: endOfDayInTz(day) } },
    select: { propertyCode: true },
  });
  await ensurePropertyCoords(codes.map((c) => c.propertyCode!), { maxCalls: 3, now }).catch(() => log.warn("geo.inline_failed"));
  const r = await dayRoute(actor, { day, consultantId: sp.consultora ?? null }, now);
  const editable = new Map<string, boolean>();
  for (const s of r.stops) if (s.propertyCode && !editable.has(s.propertyCode)) editable.set(s.propertyCode, await canEditPropertyAddress(actor, s.propertyCode));
  const qs = (o: { dia?: string; consultora?: string | null }) => {
    const p = new URLSearchParams();
    const d = o.dia ?? day;
    if (d !== today) p.set("dia", d);
    const c = o.consultora === undefined ? r.consultantId : o.consultora;
    if (global && c) p.set("consultora", c);
    const t = p.toString();
    return `/rota${t ? `?${t}` : ""}`;
  };
  const consultantName = r.consultants.find((c) => c.id === r.consultantId)?.name;
  const isToday = day === today;
  const firstNext = r.stops.find((x) => x.pending && x.scheduledStart > now)?.id;
  const mapStops: MapStop[] = r.stops.map((x, i) => {
    const tone = visitTone(x, now);
    return {
      id: x.id,
      n: i + 1,
      time: fmt.time(x.scheduledStart),
      end: fmt.time(x.scheduledEnd),
      status: x.status === "SCHEDULED" ? (TONE_LABEL[tone] ?? "Agendada") : x.evaluation ? EVALUATION_LABEL[x.evaluation] : STATUS_LABEL[x.status],
      tone: x.status !== "SCHEDULED" ? "done" : tone === "live" ? "live" : tone === "awaiting" || tone === "overdue" ? "late" : x.id === firstNext ? "next" : "later",
      client: x.clientName ?? "Cliente sem nome",
      code: x.propertyCode,
      area: x.property?.neighborhood ?? null,
      address: x.property?.address ?? null,
      approximate: x.property?.geoPrecision === "AREA",
      lat: x.property?.lat ?? null,
      lng: x.property?.lng ?? null,
      photoUrl: x.property?.photoUrl ?? null,
      href: x.status === "SCHEDULED" ? `/visitas/${x.id}/registrar` : null,
      mapsUrl: x.loc ? mapsPlaceUrl(x.loc.query) : null,
      wazeUrl: x.loc ? wazeUrl(x.loc.query) : null,
      driveMin: x.drive?.minutes ?? null,
      driveKm: x.drive?.km ?? null,
      gapMin: x.gapMin,
      tight: x.tight,
    };
  });
  const listOpen = r.stops.some((x) => x.pending && (!x.loc || x.loc.approximate)) || !r.stops.some((x) => x.property?.lat != null);

  return (
    <div className="mx-auto max-w-xl">
      <Link href={global ? "/ao-vivo" : "/minhas"} className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← {global ? "Ao vivo" : "Minhas visitas"}
      </Link>
      <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase">{fmt.longDate(new Date(day + "T15:00:00Z"))}</p>
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.035em]">{isToday ? "Rota de hoje" : day === tomorrow ? "Rota de amanhã" : "Rota do dia"}</h1>
      <p className="mt-1.5 text-[15px] text-ink-2">
        {r.stops.length === 0
          ? "Nenhuma visita neste dia."
          : `${r.stops.length} ${r.stops.length === 1 ? "visita" : "visitas"}${consultantName && global ? ` de ${consultantName.split(" ")[0]}` : ""} · ${fmt.time(r.stops[0].scheduledStart)} às ${fmt.time(r.stops[r.stops.length - 1].scheduledEnd)}`}
      </p>

      <div className="mt-5 mb-5 flex flex-col gap-3">
        <Segmented
          label="Dia"
          items={[
            { href: qs({ dia: today }), label: "Hoje", active: isToday },
            { href: qs({ dia: tomorrow }), label: "Amanhã", active: day === tomorrow },
          ]}
        />
        {global && r.consultants.length > 0 && (
          <Segmented label="Consultora" items={r.consultants.map((c) => ({ href: qs({ consultora: c.id }), label: c.name.split(" ")[0], active: c.id === r.consultantId }))} />
        )}
      </div>

      {r.stops.length > 0 && <RouteMapLazy stops={mapStops} line={r.line} totalDriveMin={r.totalDriveMin} />}

      {r.routeUrl ? (
        <a
          href={r.routeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="press mb-3 flex min-h-14 items-center justify-center gap-2.5 rounded-full bg-primary px-6 text-[16px] font-semibold text-on-primary shadow-[0_10px_24px_-12px_rgb(29_32_35/0.7)] dark:shadow-none"
        >
          <Icon name="route" className="size-5" />
          Abrir rota no Google Maps
          <span className="rounded-full bg-on-primary/15 px-2 py-0.5 text-[13px]">{r.remaining > 10 ? "10" : r.remaining} {r.remaining === 1 ? "parada" : "paradas"}</span>
        </a>
      ) : (
        r.stops.length > 0 && (
          <p className="mb-3 rounded-3xl border border-dashed border-line-strong px-5 py-4 text-center text-sm text-ink-3">
            {r.stops.some((s) => s.pending) ? "Informe o endereço dos imóveis abaixo para montar a rota." : "Nenhuma visita pela frente neste dia."}
          </p>
        )
      )}
      {r.routeUrl && (
        <p className="mb-7 text-center text-[12px] text-ink-3">
          Sai de onde você está e segue a ordem dos horários.{r.missing > 0 ? ` ${r.missing} ${r.missing === 1 ? "visita ficou" : "visitas ficaram"} de fora por falta de endereço.` : ""}
          {r.remaining > 10 ? " O Maps aceita até 10 paradas por vez." : ""}
        </p>
      )}

      {r.stops.length > 0 && (
      <details className="group" open={listOpen}>
        <summary className="mb-3 flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-bold tracking-[0.1em] text-ink-3 uppercase">
          Lista e endereços ({r.stops.length})
          <span aria-hidden className="text-lg transition-transform group-open:rotate-45">+</span>
        </summary>
      <ol className="relative">
        {r.stops.map((s, i) => {
          const tone = visitTone(s, now);
          const status = s.status === "SCHEDULED" ? TONE_LABEL[tone] ?? "Agendada" : s.evaluation ? EVALUATION_LABEL[s.evaluation] : STATUS_LABEL[s.status];
          const canEdit = !!s.propertyCode && editable.get(s.propertyCode);
          return (
            <li key={s.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }}>
              {s.gapMin !== null && (
                <div className="flex items-center gap-3 py-2 pl-[22px]">
                  <span aria-hidden className="h-7 w-px border-l-2 border-dotted border-line-strong" />
                  <span
                    className={cx(
                      "rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
                      s.overlap ? "bg-bad-soft text-bad" : s.tight ? "bg-accent-soft text-accent-strong" : "bg-tint text-ink-3",
                    )}
                  >
                    {s.overlap
                      ? "Horário sobreposto com a anterior"
                      : s.sameProperty
                        ? `Mesmo imóvel · ${gapText(s.gapMin)} de intervalo`
                        : s.tight
                          ? s.drive
                            ? `Apertado: ${gapText(s.gapMin)} de intervalo e ~${s.drive.minutes} min de carro`
                            : `Só ${gapText(s.gapMin)} para chegar${s.property?.neighborhood ? ` em ${s.property.neighborhood}` : ""}`
                          : s.gapMin === 0
                            ? "Em seguida"
                            : `${gapText(s.gapMin)} livre${s.drive ? ` · ~${s.drive.minutes} min de carro` : s.sameArea ? " · mesmo bairro" : ""}`}
                  </span>
                </div>
              )}
              <div className={cx("relative overflow-hidden rounded-[26px] border border-line bg-surface shadow-card", !s.pending && "opacity-75")}>
                <span aria-hidden className={cx("absolute inset-y-0 left-0 w-[5px]", TONE_BAR[tone])} />
                <div className="flex gap-4 pt-5 pr-5 pb-4 pl-6">
                  <div className="flex flex-col items-center">
                    <span className="num text-[17px] font-bold">{fmt.time(s.scheduledStart)}</span>
                    <span className="num text-[12px] text-ink-3">{fmt.time(s.scheduledEnd)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cx("text-[12px] font-bold tracking-[0.06em] uppercase", TONE_TEXT[tone])}>
                      {status}
                      {s.pending && isToday && <span className="font-medium tracking-normal normal-case text-ink-3"> · {relativeTime(s.scheduledStart, now)}</span>}
                    </p>
                    <p className="mt-0.5 text-[17px] leading-snug font-bold tracking-[-0.015em] break-words">{s.clientName ?? "Cliente sem nome"}</p>
                    <p className="mt-0.5 text-sm text-ink-2">
                      <span className="num font-semibold text-ink">{s.propertyCode ?? "sem código"}</span>
                      {s.property?.category ? ` · ${s.property.category}` : ""}
                      {s.property?.neighborhood ? ` · ${s.property.neighborhood}` : ""}
                    </p>
                  </div>
                  <PropertyThumb photoUrl={s.property?.photoUrl} className="size-14" />
                </div>
                <div className="border-t border-line px-6 py-3">
                  {s.loc ? (
                    <div className="flex items-start gap-2 text-sm">
                      <Icon name="pin" className="mt-0.5 size-4 shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 break-words text-ink-2">
                        {s.property?.address ?? s.loc.query}
                        {s.loc.approximate && <span className="ml-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-strong">só o bairro</span>}
                      </span>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-warn">
                      <Icon name="pin" className="size-4 shrink-0" /> Sem endereço
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {s.loc && (
                      <>
                        <a href={mapsPlaceUrl(s.loc.query)} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-10 items-center rounded-full bg-tint px-4 text-[13px] font-semibold text-ink">
                          Maps
                        </a>
                        <a href={wazeUrl(s.loc.query)} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-10 items-center rounded-full bg-tint px-4 text-[13px] font-semibold text-ink">
                          Waze
                        </a>
                      </>
                    )}
                    {s.status === "SCHEDULED" && (
                      <Link href={`/visitas/${s.id}/registrar`} className="press inline-flex min-h-10 items-center rounded-full px-3 text-[13px] font-semibold text-ink-2 underline underline-offset-4">
                        Abrir visita
                      </Link>
                    )}
                  </div>
                  {canEdit && (
                    <AddressEditor code={s.propertyCode!} address={s.property?.address ?? null} compact={!!s.property?.address || !s.pending} />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      </details>
      )}
      <p className="pt-6 pb-6 text-center text-[12px] text-ink-3">
        O endereço vem do campo “Local” do evento na agenda ou do que for informado aqui. Sem endereço, a rota usa o bairro do anúncio.
      </p>
    </div>
  );
}
