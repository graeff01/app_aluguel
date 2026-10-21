"use client";
import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

/* Ditado do próprio navegador (Web Speech API). Nada é gravado nem enviado pelo app: o texto vem do celular. */
type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecCtor = new () => Rec;

function recognitionCtor(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "O microfone está bloqueado. Libere o microfone para este site nos ajustes do navegador, ou use o microfone do teclado.",
  "service-not-allowed": "O ditado não está disponível neste aparelho. Use o microfone do teclado e toque em “Preencher pelo que escrevi”.",
  "no-speech": "Não ouvi nada. Toque de novo e fale perto do celular.",
  "audio-capture": "Não encontrei o microfone do aparelho.",
  network: "O ditado precisa de internet. Tente de novo ou use o microfone do teclado.",
};

/** Botão "Falar como foi": escuta, mostra o texto ao vivo e entrega a frase final. */
export function VoiceCapture({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const finalText = useRef("");

  useEffect(() => setSupported(!!recognitionCtor()), []);
  useEffect(() => () => rec.current?.abort(), []);

  if (!supported) return null;

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    setLive("");
    finalText.current = "";
    const r = new Ctor();
    r.lang = "pt-BR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += `${res[0].transcript} `;
        else interim += res[0].transcript;
      }
      setLive(`${finalText.current}${interim}`.trim());
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(ERRORS[e.error] ?? "Não consegui ouvir. Tente de novo ou use o microfone do teclado.");
    };
    r.onend = () => {
      setListening(false);
      const text = finalText.current.trim();
      if (text) onText(text);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
      try {
        navigator.vibrate?.(12);
      } catch {}
    } catch {
      setError("Não consegui abrir o microfone. Tente de novo.");
    }
  }

  return (
    <div className={cx("mb-6 overflow-hidden rounded-[22px] border p-4 transition-colors", listening ? "border-accent/50 bg-accent-soft" : "border-line bg-surface shadow-card")}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => (listening ? rec.current?.stop() : start())}
          disabled={disabled}
          aria-pressed={listening}
          aria-label={listening ? "Parar e preencher" : "Falar como foi a visita"}
          className={cx(
            "press relative grid size-14 shrink-0 place-items-center rounded-full text-white shadow-float transition disabled:opacity-40",
            listening ? "bg-bad" : "bg-accent",
          )}
        >
          {listening && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-bad/40" />}
          {listening ? (
            <span aria-hidden className="relative size-4 rounded-[4px] bg-white" />
          ) : (
            <svg aria-hidden viewBox="0 0 24 24" className="relative size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          )}
        </button>
        <div className="min-w-0">
          <p className="text-[16px] font-bold tracking-[-0.01em]">{listening ? "Ouvindo… toque para terminar" : "Falar como foi a visita"}</p>
          <p className="text-[13px] text-ink-3">{listening ? "Fale normalmente. O app preenche o resto." : "Ex.: “Gostou, mas vai falar com o marido e me dá retorno na sexta.”"}</p>
        </div>
      </div>
      {(listening || live) && live && (
        <p aria-live="polite" className="mt-3 rounded-2xl bg-surface/80 px-4 py-3 text-[15px] leading-snug text-ink-2">
          “{live}”
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[13px] font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
