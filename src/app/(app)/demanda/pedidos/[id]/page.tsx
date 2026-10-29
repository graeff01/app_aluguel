import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireActor } from "@/lib/require";
import { canSeeDemand, captureRequests } from "@/server/demand";
import { OUTCOME_TONE, outcomeText } from "@/server/capture";
import { marketLine } from "@/server/market";
import { fmt } from "@/lib/time";
import { cx } from "@/components/ui";
import { nextStep, pedidoTitle } from "@/components/capture-requests-view";
import { CaptureOwnerButton } from "@/components/capture-owner";
import { MarketNoteForm } from "@/components/market-note-form";
import { CaptureFoundForm } from "../found-form";
import { PedidoOptions } from "../options";

export const metadata = { title: "Pedido para a captação" };

const ROLE_SHORT: Record<string, string> = { PRE_SERVICE: "pré-atendimento", CONSULTANT: "consultora", MANAGER: "gestão", ADMIN: "gestão" };
const TONE_CLS = { neutral: "bg-tint text-ink-2", bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", good: "bg-good-soft text-good" } as const;
const STEP_CLS = { bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", good: "bg-good-soft text-good", accent: "bg-accent-soft text-accent-strong", neutral: "bg-tint text-ink-2" } as const;
const card = "rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-5";

/** Um pedido: o que o cliente procura, opções do site para indicar, o que já foi indicado e o parecer. */
export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor({ capture: true });
  if (!canSeeDemand(actor)) notFound();
  const { id } = await params;
  const r = (await captureRequests(actor)).find((x) => x.id === id);
  if (!r) notFound();
  const capture = actor.role === "CAPTURE";
  const mine = r.captureOwnerId === actor.id;
  const open = r.status !== "CLOSED";
  const step = nextStep(r, actor.id, null);

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <Link href="/demanda/pedidos" className="mb-3 flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Pedidos
      </Link>
      <span className={cx("inline-flex rounded-full px-3 py-1 text-[13px] font-bold", STEP_CLS[step.tone])}>{step.text}</span>
      <h1 className="mt-2 text-[28px] leading-tight font-bold tracking-[-0.03em]">{pedidoTitle(r)}</h1>
      <p className="text-[16px] text-ink-2">{r.areas.join(", ") || "Sem bairro"}</p>
      <p className="mt-1 text-[13px] text-ink-3">
        Pedido de {r.createdBy.name.split(" ")[0]} ({ROLE_SHORT[r.createdBy.role] ?? "atendimento"}) · {fmt.shortDate(r.sentToCaptureAt!).replace(".", "")} · {r.days === 0 ? "hoje" : `há ${r.days} dia${r.days === 1 ? "" : "s"}`}
        {r.captureOwner && !mine ? ` · ${r.captureOwner.name.split(" ")[0]} está buscando` : ""}
      </p>

      <section className={cx(card, "mt-5")}>
        <h2 className="text-[13px] font-semibold tracking-wide text-ink-3 uppercase">O que o cliente procura</h2>
        <p className="mt-1.5 text-[16px] leading-snug whitespace-pre-wrap">{r.wants}</p>
      </section>

      {open && r.status === "SEARCHING" && (
        <section id="opcoes" className={cx(card, "mt-4 scroll-mt-24")}>
          <h2 className="mb-2 text-[16px] font-bold">Opções no site</h2>
          <Suspense fallback={<p className="text-[14px] text-ink-3">Buscando no site…</p>}>
            <PedidoOptions r={r} />
          </Suspense>
        </section>
      )}

      {r.results.length > 0 && (
        <section className={cx(card, "mt-4")}>
          <h2 className="mb-2 text-[16px] font-bold">Já indicados</h2>
          <ul className="space-y-2">
            {r.results.map((x) => (
              <li key={x.code} className="flex flex-wrap items-center justify-between gap-2">
                <span className="num text-[15px] font-semibold">Imóvel {x.code}</span>
                <span className={cx("rounded-full px-2.5 py-0.5 text-[13px] font-semibold", TONE_CLS[OUTCOME_TONE[x.outcome]])}>{outcomeText(x)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={cx(card, "mt-4")}>
        <h2 className="text-[16px] font-bold">Parecer de mercado</h2>
        {r.marketTag ? <p className="mt-1 text-[14px] text-ink-2">{marketLine({ tag: r.marketTag, text: r.marketNote, cents: r.marketCents })}</p> : <p className="mt-1 text-[13px] text-ink-3">Diga ao atendimento o que o mercado oferece para esse perfil (ex.: “nesse valor, só com menos quartos”).</p>}
        {open && <MarketNoteForm hidden={{ radarId: r.id }} label={r.marketTag ? "Editar parecer" : "Escrever parecer"} initial={{ tag: r.marketTag, text: r.marketNote, cents: r.marketCents }} />}
      </section>

      {open && (
        <details className="group mt-4 rounded-3xl border border-line bg-surface-2 px-4 py-3">
          <summary className="cursor-pointer list-none text-[14px] font-semibold text-ink-2">
            ⋯ Mais ações <span className="text-ink-3 transition group-open:rotate-90">›</span>
          </summary>
          <div className="mt-2 flex flex-wrap items-start gap-x-4">
            <CaptureFoundForm id={r.id} />
            {capture && mine && <CaptureOwnerButton id={r.id} mine taken />}
          </div>
        </details>
      )}

      {/* ação principal sempre à mão (acima da barra do celular) */}
      {open && capture && (
        // à direita fica o botão de ajuda (fixo no canto)
        <div className="fixed bottom-24 left-4 right-20 z-20 md:bottom-6 md:left-auto md:w-[420px]">
          <div className="mx-auto max-w-2xl rounded-full shadow-float">
            {!mine ? (
              <CaptureOwnerButton id={r.id} mine={false} taken={!!r.captureOwnerId} big />
            ) : r.status === "SEARCHING" ? (
              <a href="#opcoes" className="press flex min-h-12 w-full items-center justify-center rounded-full bg-accent px-6 text-[16px] font-semibold text-white">
                Indicar um imóvel
              </a>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
