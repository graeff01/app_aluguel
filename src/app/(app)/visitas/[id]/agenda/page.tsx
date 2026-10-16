import Link from "next/link";
import { requireActor, orNotFound } from "@/lib/require";
import { calendarLinkFor } from "@/server/reschedule";
import { getVisitDetail } from "@/server/queries";
import { fmt } from "@/lib/time";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { hasGlobalView } from "@/lib/authz";

export const metadata = { title: "Colocar na agenda" };

export default async function AgendaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nova?: string; remarcada?: string; google?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  const { visit } = await orNotFound(getVisitDetail(actor, id));
  const cal = await orNotFound(calendarLinkFor(actor, id));
  const back = hasGlobalView(actor) ? `/visitas/${visit.id}` : "/minhas";
  return (
    <div className="mx-auto max-w-xl">
      <RefreshOnFocus minIntervalMs={3000} />
      {(sp.nova || sp.remarcada) && (
        <p role="status" className="animate-rise mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">
          ✓ {sp.remarcada ? "Visita remarcada" : "Nova visita marcada"} para {fmt.shortDate(visit.scheduledStart)} às {fmt.time(visit.scheduledStart)}. Já está no app.
        </p>
      )}
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">{cal.linked || cal.created ? "Já está na agenda" : "Agora, coloque na agenda"}</h1>
      <p className="mt-1.5 mb-6 text-[15px] text-ink-2">
        {visit.clientName} · imóvel {visit.propertyCode} · {fmt.shortDate(visit.scheduledStart)}, {fmt.time(visit.scheduledStart)}–{fmt.time(visit.scheduledEnd)}
      </p>

      {cal.linked ? (
        <div className="rounded-[26px] border border-good/20 bg-good-soft p-5 text-good">
          <p className="text-[16px] font-bold">✓ O evento chegou da agenda e está ligado a esta visita.</p>
          <p className="mt-1 text-sm text-good/80">Nada mais a fazer.</p>
        </div>
      ) : cal.created ? (
        <div className="rounded-[26px] border border-good/20 bg-good-soft p-5 text-good">
          <p className="text-[16px] font-bold">✓ O app criou o evento na agenda Google.</p>
          <p className="mt-1 text-sm text-good/80">Os convidados receberam o convite{cal.guests.length ? ` (${cal.guests.join(", ")})` : ""}. Nada mais a fazer.</p>
        </div>
      ) : (
        <>
        {sp.google === "error" && <p role="alert" className="mb-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn">Não consegui criar o evento sozinho no Google agora. Use o botão abaixo.</p>}
        <div className="rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
          <a
            href={cal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="press flex min-h-14 items-center justify-center gap-2.5 rounded-full bg-primary px-6 text-[16px] font-semibold text-on-primary shadow-[0_10px_24px_-12px_rgb(29_32_35/0.7)] dark:shadow-none"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
              <path d="M8 3v4M16 3v4M3.5 10h17M12 13.5v4M10 15.5h4" />
            </svg>
            Colocar na agenda Google
          </a>
          <ol className="mt-5 space-y-2 text-[14px] text-ink-2">
            <li>
              <strong className="text-ink">1.</strong> O Google Agenda abre com o evento preenchido{cal.guests.length ? <> e a conta central (<span className="break-all">{cal.guests.join(", ")}</span>) como convidada</> : null}.
            </li>
            <li>
              <strong className="text-ink">2.</strong> Confira e toque em <strong className="text-ink">Salvar</strong> (e em “Enviar” se perguntar sobre convidados).
            </li>
            <li>
              <strong className="text-ink">3.</strong> Pronto: em poucos minutos o app liga o evento a esta visita, sem duplicar. Não apague a linha “Ref.: {cal.code}” da descrição.
            </li>
          </ol>
        </div>
        </>
      )}
      <div className="mt-6 flex justify-center">
        <Link href={back} className="text-sm font-semibold text-ink underline underline-offset-4">
          {hasGlobalView(actor) ? "Ver a visita" : "Voltar para Minhas visitas"}
        </Link>
      </div>
    </div>
  );
}
