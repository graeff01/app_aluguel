import Link from "next/link";
import { requireActor } from "@/lib/require";
import { ROLE_LABEL } from "@/lib/labels";
import { faqFor, topicsFor } from "@/lib/help-content";
import { PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Central de ajuda" };

/** Passo a passo das telas do perfil e dúvidas frequentes. */
export default async function HelpPage() {
  const actor = await requireActor({ preService: true, marketing: true });
  const topics = topicsFor(actor.role);
  const faq = faqFor(actor.role);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Central de ajuda" subtitle={`Passo a passo das telas de ${ROLE_LABEL[actor.role]?.toLowerCase() ?? "você"} e as dúvidas mais comuns. Em qualquer tela, o “?” no canto mostra a ajuda daquela tela.`} />
      <div className="mb-8 flex flex-wrap gap-2">
        <Link href="/ajuda/novidades" className="press inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-[14px] font-semibold text-on-primary">
          O que mudou no app →
        </Link>
        {topics.map((t) => (
          <a key={t.id} href={`#${t.id}`} className="press inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-[13px] font-semibold text-ink-2">
            {t.title}
          </a>
        ))}
      </div>
      <Section title="Passo a passo">
        <div className="space-y-4">
          {topics.map((t) => (
            <article key={t.id} id={t.id} className="scroll-mt-24 rounded-3xl border border-line bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[18px] font-bold tracking-[-0.01em]">{t.title}</h3>
                {t.href && (
                  <Link href={t.href} className="text-[13px] font-semibold text-accent-strong underline-offset-4 hover:underline">
                    Abrir a tela →
                  </Link>
                )}
              </div>
              <p className="mt-1 text-[14px] text-ink-2">{t.summary}</p>
              <ol className="mt-3 space-y-2">
                {t.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-[15px] leading-snug">
                    <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-tint text-[12px] font-bold">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              {t.tips?.length ? (
                <ul className="mt-3 space-y-1 rounded-2xl bg-surface-2 p-3 text-[13px] text-ink-2">
                  {t.tips.map((x, i) => (
                    <li key={i}>💡 {x}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </Section>
      <Section title="Dúvidas frequentes">
        <div className="divide-y divide-line rounded-3xl border border-line bg-surface shadow-card">
          {faq.map((f, i) => (
            <details key={i} className="group px-5 py-1">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                {f.q}
                <span aria-hidden className="text-lg text-ink-3 transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="pb-4 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>
      <p className="mb-8 text-[13px] text-ink-3">Não achou? Fale com a gestão.</p>
    </div>
  );
}
