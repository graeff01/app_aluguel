import { AFTERCARE_STEP_LABEL, REFERRAL_TIPS, type dueAftercare } from "@/server/aftercare";
import { completeAftercareAction } from "@/app/actions/proposals";
import { whatsappUrl } from "@/lib/confirm";
import { ContactButtons } from "./contact-buttons";
import { InlineAction } from "./inline-action";
import { PropertyThumb } from "./property-thumb";

const br = (k: string) => k.split("-").reverse().slice(0, 2).join("/");

/** Pós-contrato na tela inicial: boas-vindas e pedido de indicação, com a mensagem pronta para o WhatsApp. */
export function AftercareList({ items }: { items: Awaited<ReturnType<typeof dueAftercare>> }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="t-pos" className="mb-9">
      <h2 id="t-pos" className="mb-3 text-[12px] font-bold tracking-[0.12em] text-good uppercase">
        Pós-contrato · fale com o cliente
      </h2>
      <ul className="grid gap-3 2xl:grid-cols-2">
        {items.map((a, i) => (
          <li key={`${a.opportunityId}-${a.step}`} className="animate-rise relative overflow-hidden rounded-[26px] border border-good/30 bg-surface shadow-card" style={{ animationDelay: `${i * 55}ms` }}>
            <span aria-hidden className="absolute inset-y-0 left-0 w-[5px] bg-good" />
            <div className="flex gap-4 pt-5 pr-5 pb-3 pl-6">
              <PropertyThumb photoUrl={a.photoUrl} className="size-14" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold tracking-[0.06em] text-good uppercase">
                  {a.step === "welcome" ? "1º contato" : "2º contato"} · {AFTERCARE_STEP_LABEL[a.step]}
                </p>
                <p className="mt-0.5 text-[17px] font-bold">{a.clientName}</p>
                <p className="text-sm text-ink-2">
                  <span className="num font-semibold text-ink">{a.propertyCode}</span>
                  {a.neighborhood ? ` · ${a.neighborhood}` : ""} · contrato assinado em {br(a.signedOn)}
                </p>
              </div>
            </div>
            <details className="group mx-5 mb-3 ml-6 rounded-2xl bg-tint">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-[13px] font-semibold">
                {a.step === "welcome" ? "Sugestão de mensagem" : "Sugestão de abordagem"}
                <span aria-hidden className="text-lg text-ink-3 transition-transform group-open:rotate-45">+</span>
              </summary>
              <div className="px-4 pb-4 text-[14px] text-ink-2">
                <p className="whitespace-pre-line">“{a.message}”</p>
                {a.step === "referral" && (
                  <ul className="mt-3 space-y-1 text-[13px]">
                    {REFERRAL_TIPS.map((t) => (
                      <li key={t} className="flex gap-2">
                        <span aria-hidden className="text-good">•</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
            <div className="flex flex-wrap items-center gap-2 pr-5 pb-5 pl-6">
              {a.phone && (
                <a href={whatsappUrl(a.phone, a.message)} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-10 items-center gap-2 rounded-full bg-[#1f9e4f] px-4 text-[13px] font-semibold text-white">
                  <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="currentColor">
                    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" />
                  </svg>
                  Mensagem no WhatsApp
                </a>
              )}
              {a.phone && <ContactButtons phone={a.phone} name={a.clientName} compact />}
              <InlineAction action={completeAftercareAction} fields={{ opportunityId: a.opportunityId, step: a.step }} label={a.step === "welcome" ? "Fiz o contato" : "Pedi a indicação"} variant="primary" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
