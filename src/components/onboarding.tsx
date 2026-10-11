"use client";
/**
 * Primeiro acesso guiado: boas-vindas, instalar o app, ativar notificações e como usar.
 * Adapta-se ao aparelho (iPhone exige o app instalado para notificações) e ao perfil.
 */
import { useEffect, useMemo, useState } from "react";
import { completeOnboardingAction } from "@/app/actions/auth";
import { usePush } from "./push-toggle";
import { BrandSymbol } from "./brand";
import { Icon, type IconName } from "./icons";
import { cx } from "./ui";

type BIP = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
type Platform = { ios: boolean; android: boolean; mobile: boolean; standalone: boolean };
type StepKey = "welcome" | "install" | "notify" | "howto";

const HOWTO: Record<"consultant" | "manager", { icon: IconName; title: string; text: string }[]> = {
  consultant: [
    { icon: "today", title: "Antes da visita", text: "Toque na visita e veja a ficha: valores, fotos, histórico do cliente e pontos para a conversa." },
    { icon: "check", title: "Depois da visita", text: "“Registrar resultado”: aconteceu? gostou? e uma observação (dá para ditar). Leva menos de um minuto." },
    { icon: "route", title: "Rota do dia", text: "O mapa com todas as paradas na ordem e o tempo de carro entre elas. Abre no Maps ou no Waze." },
  ],
  manager: [
    { icon: "live", title: "Ao vivo", text: "O dia de cada consultora agora: em visita, sem resultado, próximas — e o botão Cobrar." },
    { icon: "thermo", title: "Imóveis", text: "Termômetro dos imóveis encalhando e o relatório em PDF para o proprietário." },
    { icon: "audit", title: "Relatórios", text: "Relatório mensal em PDF para a direção, com comparação entre consultoras." },
  ],
};

export function Onboarding({ name, role, pushKey }: { name: string; role: "ADMIN" | "MANAGER" | "CONSULTANT"; pushKey: string | null }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BIP | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHandoff, setIosHandoff] = useState(false);
  const push = usePush(pushKey);
  const first = name.split(" ")[0];
  const kind = role === "CONSULTANT" ? "consultant" : "manager";

  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua);
    const android = /android/i.test(ua);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setPlatform({ ios, android, mobile: ios || android || /Mobi/i.test(ua), standalone });
    const h = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BIP);
    };
    const done = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", h);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  const steps = useMemo<StepKey[]>(() => {
    if (!platform) return ["welcome"];
    const s: StepKey[] = ["welcome"];
    if (platform.mobile && !platform.standalone) s.push("install");
    if (pushKey && push.state !== "unsupported") s.push("notify");
    s.push("howto");
    return s;
  }, [platform, pushKey, push.state]);
  const key = steps[Math.min(step, steps.length - 1)];
  const last = step >= steps.length - 1;

  async function finish(skipped: boolean) {
    setBusy(true);
    try {
      await completeOnboardingAction(skipped);
    } finally {
      window.location.replace("/");
    }
  }
  const next = () => (last ? finish(false) : setStep((x) => x + 1));

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" role="dialog" aria-modal="true" aria-labelledby="ob-title">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mb-8 flex items-center justify-between">
          <BrandSymbol className="size-9" />
          <div className="flex gap-1.5" aria-label={`Passo ${step + 1} de ${steps.length}`}>
            {steps.map((_, i) => (
              <span key={i} className={cx("h-1.5 rounded-full transition-all duration-300", i === step ? "w-6 bg-accent" : i < step ? "w-1.5 bg-ink" : "w-1.5 bg-line-strong")} />
            ))}
          </div>
          <button type="button" onClick={() => finish(true)} disabled={busy} className="min-h-10 px-1 text-sm font-semibold text-ink-3 hover:text-ink">
            Pular
          </button>
        </div>

        <div key={key} className="animate-rise flex-1">
          {key === "welcome" && (
            <>
              <h1 id="ob-title" className="text-[30px] leading-tight font-bold tracking-[-0.035em]">
                Olá, {first}!
              </h1>
              <p className="mt-2 text-[16px] text-ink-2">Em menos de um minuto o app fica pronto para você.</p>
              <ul className="mt-8 space-y-4">
                {(kind === "consultant"
                  ? ["Suas visitas chegam sozinhas da agenda.", "Você registra o resultado em segundos, no celular.", "O app lembra você — nada fica para trás."]
                  : ["As visitas chegam sozinhas da agenda da equipe.", "Você acompanha o dia de cada consultora ao vivo.", "Relatórios e PDFs prontos para a direção e proprietários."]
                ).map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[15px]">
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-good-soft text-good">
                      <Icon name="check" className="size-3.5" />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </>
          )}

          {key === "install" && platform && (
            <>
              <StepIcon name="plus" />
              <h1 id="ob-title" className="text-[26px] leading-tight font-bold tracking-[-0.03em]">
                Instale o app na tela inicial
              </h1>
              <p className="mt-2 text-[15px] text-ink-2">Abre em um toque, em tela cheia, como um aplicativo{platform.ios ? " — e no iPhone é o que libera as notificações" : ""}.</p>
              {installed ? (
                <p className="mt-6 rounded-2xl bg-good-soft px-4 py-3 text-[15px] font-semibold text-good">✓ App instalado.</p>
              ) : platform.ios ? (
                <ol className="mt-6 space-y-3">
                  {[
                    <>Toque em <strong>Compartilhar</strong> <ShareGlyph /> na barra do Safari.</>,
                    <>Role e toque em <strong>Adicionar à Tela de Início</strong>.</>,
                    <>Abra pelo novo ícone e entre com seu e-mail.</>,
                  ].map((t, i) => (
                    <li key={i} className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-[15px]">
                      <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[13px] font-bold text-on-primary">{i + 1}</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ol>
              ) : installPrompt ? (
                <button
                  type="button"
                  onClick={async () => {
                    await installPrompt.prompt();
                    const c = await installPrompt.userChoice?.catch(() => null);
                    if (!c || c.outcome === "accepted") setInstalled(true);
                  }}
                  className="press mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-[16px] font-semibold text-on-primary"
                >
                  Instalar agora
                </button>
              ) : (
                <p className="mt-6 rounded-2xl border border-line bg-surface px-4 py-3 text-[15px]">
                  No Chrome, toque em <strong>⋮</strong> e depois em <strong>Instalar app</strong> (ou “Adicionar à tela inicial”).
                </p>
              )}
              {iosHandoff && (
                <p role="status" className="mt-4 rounded-2xl bg-accent-soft px-4 py-3 text-[14px] font-medium text-accent-strong">
                  Agora abra pelo ícone na tela inicial e entre com seu e-mail — o guia continua por lá, com as notificações.
                </p>
              )}
            </>
          )}

          {key === "notify" && (
            <>
              <StepIcon name="pending" />
              <h1 id="ob-title" className="text-[26px] leading-tight font-bold tracking-[-0.03em]">
                Ative as notificações
              </h1>
              <p className="mt-2 text-[15px] text-ink-2">
                {kind === "consultant" ? "É assim que o app avisa antes de cada visita e pergunta “Como foi?” quando ela termina." : "É assim que você fica sabendo de visitas sem resultado e se a agenda parar."}
              </p>
              <div className="mt-6">
                {push.state === "on" ? (
                  <p className="rounded-2xl bg-good-soft px-4 py-3 text-[15px] font-semibold text-good">✓ Notificações ativadas neste aparelho.</p>
                ) : push.state === "ios-install" ? (
                  <p className="rounded-2xl bg-accent-soft px-4 py-3 text-[15px] text-accent-strong">No iPhone, as notificações só funcionam com o app instalado. Instale, abra pelo ícone e ative por lá.</p>
                ) : push.state === "denied" ? (
                  <p className="rounded-2xl bg-bad-soft px-4 py-3 text-[15px] text-bad">As notificações estão bloqueadas para este site. Libere nas configurações do navegador e volte aqui.</p>
                ) : (
                  <button type="button" onClick={push.enable} disabled={push.state === "busy" || push.state === "loading"} className="press flex min-h-14 w-full items-center justify-center rounded-full bg-primary text-[16px] font-semibold text-on-primary disabled:opacity-60">
                    {push.state === "busy" ? "Ativando…" : "Ativar notificações"}
                  </button>
                )}
                {push.state === "error" && <p className="mt-2 text-sm font-semibold text-bad">Não foi possível ativar agora. Tente de novo.</p>}
              </div>
            </>
          )}

          {key === "howto" && (
            <>
              <h1 id="ob-title" className="text-[26px] leading-tight font-bold tracking-[-0.03em]">
                Como usar
              </h1>
              <ul className="mt-6 space-y-3">
                {HOWTO[kind].map((h, i) => (
                  <li key={h.title} className="animate-rise flex gap-4 rounded-3xl border border-line bg-surface p-4 shadow-card" style={{ animationDelay: `${i * 80}ms` }}>
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-tint text-ink">
                      <Icon name={h.icon} className="size-5" />
                    </span>
                    <span>
                      <span className="block text-[16px] font-bold">{h.title}</span>
                      <span className="text-[14px] text-ink-2">{h.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="mt-8 flex flex-col gap-2">
          {key === "install" && platform?.ios && !installed && !iosHandoff ? (
            <>
              <button type="button" onClick={() => setIosHandoff(true)} className="press min-h-14 rounded-full bg-primary text-[16px] font-semibold text-on-primary">
                Já adicionei à tela inicial
              </button>
              <button type="button" onClick={next} className="min-h-12 text-[15px] font-semibold text-ink-2">
                Continuar sem instalar
              </button>
            </>
          ) : (
            <button type="button" onClick={next} disabled={busy} className="press min-h-14 rounded-full bg-primary text-[16px] font-semibold text-on-primary disabled:opacity-60">
              {busy ? "Abrindo…" : last ? "Começar a usar" : key === "welcome" ? "Vamos lá" : key === "notify" && push.state !== "on" ? "Agora não" : "Continuar"}
            </button>
          )}
          {step > 0 && (
            <button type="button" onClick={() => setStep((x) => x - 1)} className="min-h-11 text-sm font-semibold text-ink-3">
              Voltar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepIcon({ name }: { name: IconName }) {
  return (
    <span className="mb-6 grid size-16 place-items-center rounded-[22px] bg-accent-soft text-accent-strong">
      <Icon name={name} className="size-8" />
    </span>
  );
}

function ShareGlyph() {
  return (
    <svg aria-label="ícone de compartilhar" viewBox="0 0 24 24" className="mx-0.5 inline size-[18px] -translate-y-0.5 text-[#2f6fde]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
