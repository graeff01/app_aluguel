"use client";
/* eslint-disable @next/next/no-img-element */
import { useState, useTransition } from "react";
import { ownerEstimateAction, ownerLeadAction } from "@/app/actions/owner";
import type { OwnerEstimate } from "@/server/owner-leads";
import { cx } from "@/components/ui";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const input = "block min-h-12 w-full rounded-2xl border border-line-strong bg-surface px-4 text-[16px] focus:border-ink focus:outline-none";

/** Passo 1: perfil do imóvel → estimativa e demanda. Passo 2: contato com a captação. */
export function OwnerTool({ areas, types }: { areas: string[]; types: string[] }) {
  const [profile, setProfile] = useState({ area: "", propertyType: "", bedrooms: "" });
  const [est, setEst] = useState<OwnerEstimate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  const [contact, setContact] = useState({ name: "", phone: "", wanted: "", message: "", consent: false });
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  const estimate = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await ownerEstimateAction(profile);
      if (!r.ok) return setErr(r.message);
      setErr(null);
      setEst(r.data);
      setTimeout(() => document.getElementById("resultado")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    });
  };
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await ownerLeadAction({ ...profile, ...contact, estimateCents: est?.range?.mid ?? null, demand: est?.demand ?? 0 });
      if (!r.ok) {
        setFieldErr(r.fieldErrors ?? {});
        return setErr(r.message ?? "Não foi possível enviar.");
      }
      setErr(null);
      setSent(true);
    });
  };

  return (
    <>
      <form onSubmit={estimate} className="mt-7 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_0.8fr]">
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold">Bairro</span>
            <input list="bairros" required value={profile.area} onChange={(e) => setProfile({ ...profile, area: e.target.value })} placeholder="Ex.: Centro" className={input} autoComplete="off" />
            <datalist id="bairros">
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold">Tipo</span>
            <select required value={profile.propertyType} onChange={(e) => setProfile({ ...profile, propertyType: e.target.value })} className={input}>
              <option value="" disabled>
                Escolha
              </option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[14px] font-semibold">Quartos</span>
            <select value={profile.bedrooms} onChange={(e) => setProfile({ ...profile, bedrooms: e.target.value })} className={input}>
              <option value="">—</option>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "Sem quarto" : n === 4 ? "4 ou mais" : n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button disabled={pending} className="press mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-accent px-6 text-[16px] font-semibold text-white shadow-float disabled:opacity-60 sm:w-auto">
          {pending && !est ? "Calculando…" : est ? "Calcular de novo" : "Ver quanto rende"}
        </button>
        {err && !est && (
          <p role="alert" className="mt-3 text-[14px] font-semibold text-bad">
            {err}
          </p>
        )}
      </form>

      {est && (
        <section id="resultado" aria-live="polite" className="mt-6 scroll-mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[26px] border border-line bg-surface p-5 shadow-card">
              <p className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">Aluguel estimado</p>
              {est.range ? (
                <>
                  <p className="num mt-1 text-[32px] leading-tight font-bold tracking-[-0.03em]">
                    {est.range.low === est.range.high ? brl(est.range.mid) : `${brl(est.range.low)} a ${brl(est.range.high)}`}
                  </p>
                  <p className="mt-1 text-[13px] text-ink-3">
                    Com base em {est.sample} imóve{est.sample === 1 ? "l parecido" : "is parecidos"} {est.scope === "area" ? `no ${est.profile.area}` : "em Canoas"}, anunciados hoje no site da Auxiliadora.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[15px] text-ink-2">{est.siteError ? "Não conseguimos consultar agora. Um especialista faz a avaliação para você." : "Poucos imóveis assim no mercado: um especialista faz a avaliação para você."}</p>
              )}
            </div>
            <div className={cx("rounded-[26px] border p-5 shadow-card", est.demand > 0 ? "border-accent/40 bg-accent-soft" : "border-line bg-surface")}>
              <p className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">Procurando agora</p>
              {est.demand > 0 ? (
                <>
                  <p className="mt-1 text-[32px] leading-tight font-bold tracking-[-0.03em]">
                    <span className="num">{est.demand}</span> cliente{est.demand > 1 ? "s" : ""}
                  </p>
                  <p className="mt-1 text-[13px] text-ink-2">
                    da Auxiliadora procuram {est.profile.propertyType.toLowerCase()} no {est.profile.area} neste momento
                    {est.demandBudgetCents && est.demand >= 2 ? `, pagando até cerca de ${brl(est.demandBudgetCents)}` : ""}.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[15px] text-ink-2">Ainda não temos um cliente com esse perfil hoje, mas novos pedidos chegam toda semana.</p>
              )}
            </div>
          </div>

          {est.examples.length > 0 && (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-ink-2">Parecidos com o seu no site</p>
              <ul className="grid grid-cols-3 gap-2">
                {est.examples.map((x) => (
                  <li key={x.code}>
                    <a href={x.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-2xl border border-line bg-surface">
                      <span className="relative block aspect-[4/3] bg-tint">{x.photoUrl && <img src={x.photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />}</span>
                      <span className="block px-2 py-1.5">
                        <span className="num block text-[13px] font-bold">{x.rentCents ? brl(x.rentCents) : "—"}</span>
                        <span className="block truncate text-[11px] text-ink-3">{x.neighborhood ?? "Canoas"}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
            {sent ? (
              <div role="status">
                <p className="text-[20px] font-bold">Pronto! 🎉</p>
                <p className="mt-1 text-[15px] text-ink-2">Um especialista da captação da Auxiliadora vai chamar você no WhatsApp para avaliar o imóvel, sem compromisso.</p>
              </div>
            ) : (
              <form onSubmit={send}>
                <p className="text-[20px] font-bold tracking-[-0.02em]">{est.demand > 0 ? "Quer alugar para um desses clientes?" : "Quer uma avaliação sem compromisso?"}</p>
                <p className="mt-1 mb-4 text-[14px] text-ink-2">Deixe seu contato: um especialista da captação chama você no WhatsApp.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[14px] font-semibold">Seu nome</span>
                    <input required value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" className={input} />
                    {fieldErr.name && <span className="mt-1 block text-[13px] font-semibold text-bad">{fieldErr.name}</span>}
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[14px] font-semibold">WhatsApp</span>
                    <input required value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="(51) 9…" className={input} />
                    {fieldErr.phone && <span className="mt-1 block text-[13px] font-semibold text-bad">{fieldErr.phone}</span>}
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[14px] font-semibold">
                      Quanto espera receber <span className="font-normal text-ink-3">(opcional)</span>
                    </span>
                    <input value={contact.wanted} onChange={(e) => setContact({ ...contact, wanted: e.target.value })} inputMode="decimal" placeholder="Ex.: 2.500" className={input} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[14px] font-semibold">
                      Algo sobre o imóvel <span className="font-normal text-ink-3">(opcional)</span>
                    </span>
                    <input value={contact.message} onChange={(e) => setContact({ ...contact, message: e.target.value })} maxLength={600} placeholder="Ex.: vaga, pátio, desocupa em dezembro" className={input} />
                  </label>
                </div>
                <label className="mt-4 flex items-start gap-2.5 text-[13px] text-ink-2">
                  <input type="checkbox" checked={contact.consent} onChange={(e) => setContact({ ...contact, consent: e.target.checked })} className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]" />
                  <span>
                    Autorizo a Auxiliadora Predial a usar meu nome e WhatsApp para falar comigo sobre a locação deste imóvel. Os dados são usados só para isso e apagados se não fecharmos negócio. Veja a{" "}
                    <a href="/privacidade" target="_blank" className="underline underline-offset-2">
                      política de privacidade
                    </a>
                    .
                  </span>
                </label>
                {fieldErr.consent && <p className="mt-1 text-[13px] font-semibold text-bad">{fieldErr.consent}</p>}
                <button disabled={pending} className="press mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#1fa855] px-6 text-[16px] font-semibold text-white disabled:opacity-60 sm:w-auto">
                  {pending ? "Enviando…" : "Quero falar com um especialista"}
                </button>
                {err && (
                  <p role="alert" className="mt-3 text-[14px] font-semibold text-bad">
                    {err}
                  </p>
                )}
              </form>
            )}
          </div>
        </section>
      )}
    </>
  );
}
