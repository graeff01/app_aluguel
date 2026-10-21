"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cx } from "@/components/ui";

type Property = { code: string; photoUrl: string | null; title: string | null; neighborhood: string | null; city: string | null } | null;
type FileRow = { id: string; itemKey: string; name: string; mime: string; size: number };
type Item = { key: string; label: string; hint?: string; required: boolean; files: FileRow[] };

const H = { "x-requested-with": "visitas" };
const sizeLabel = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Lock({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
function Check({ className = "size-4" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Cabeçalho de boas-vindas: nome, consultora e o imóvel. */
function Welcome({ firstName, consultant, property, children }: { firstName: string; consultant: string | null; property: Property; children?: React.ReactNode }) {
  return (
    <section className="animate-rise">
      <p className="mb-1 text-[12px] font-bold tracking-[0.16em] text-accent-strong uppercase">Documentos da locação</p>
      <h1 className="text-[32px] leading-[1.1] font-bold tracking-[-0.035em]">Olá, {firstName}</h1>
      {children}
      {(consultant || property) && (
        <div className="mt-5 overflow-hidden rounded-[22px] border border-line bg-surface shadow-card">
          {property && (
            <div className="flex items-center gap-3.5 p-3.5">
              {property.photoUrl ? (
                <img src={property.photoUrl} alt="" referrerPolicy="no-referrer" className="size-16 shrink-0 rounded-2xl object-cover" />
              ) : (
                <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-2xl bg-tint text-ink-3">
                  <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
                  </svg>
                </span>
              )}
              <div className="min-w-0">
                <p className="line-clamp-2 text-[15px] leading-snug font-semibold">{property.title ?? "Imóvel de interesse"}</p>
                <p className="mt-0.5 text-[13px] text-ink-3">
                  {[property.neighborhood, property.city].filter(Boolean).join(", ")}
                  {property.neighborhood || property.city ? " · " : ""}cód. {property.code}
                </p>
              </div>
            </div>
          )}
          {consultant && (
            <p className={cx("flex items-center gap-2.5 px-4 py-3 text-[14px] text-ink-2", property && "border-t border-line")}>
              <span aria-hidden className="grid size-8 place-items-center rounded-full bg-accent text-[13px] font-bold text-white">
                {consultant.trim()[0]?.toUpperCase()}
              </span>
              <span>
                Seu atendimento: <strong className="text-ink">{consultant.split(" ")[0]}</strong>
              </span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Link expirado, cancelado ou inválido. */
export function StateCard({ state }: { state: "INVALID" | "EXPIRED" | "CANCELED" }) {
  const text = {
    EXPIRED: ["Este link expirou", "Por segurança, os links de envio valem por alguns dias. Peça um novo link para a sua consultora — leva um minuto."],
    CANCELED: ["Este link não está mais ativo", "Ele foi encerrado pela equipe. Se ainda precisar enviar documentos, fale com a sua consultora."],
    INVALID: ["Link não encontrado", "Confira se o endereço foi copiado inteiro. Se o problema continuar, peça um novo link para a sua consultora."],
  }[state];
  return (
    <section className="animate-rise mt-6 rounded-[26px] border border-line bg-surface p-7 text-center shadow-card">
      <span aria-hidden className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-tint text-ink-2">
        <Lock className="size-6" />
      </span>
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">{text[0]}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{text[1]}</p>
    </section>
  );
}

/** Confirmação de identidade: 3 primeiros dígitos do CPF ou 4 últimos do celular. */
export function VerifyStep(p: { token: string; firstName: string; consultant: string | null; property: Property; verifyKind: "CPF" | "PHONE"; locked: boolean }) {
  const router = useRouter();
  const n = p.verifyKind === "CPF" ? 3 : 4;
  const [digits, setDigits] = useState<string[]>(Array(n).fill(""));
  const [error, setError] = useState<string | null>(p.locked ? "Muitas tentativas. Por segurança, o link está bloqueado por alguns minutos." : null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const value = digits.join("");

  async function submit(code = value) {
    if (code.length !== n || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/d/${p.token}/verify`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ digits: code }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.refresh();
        return;
      }
      setError(data.message ?? "Não foi possível confirmar. Tente de novo.");
      setDigits(Array(n).fill(""));
      refs.current[0]?.focus();
    } catch {
      setError("Sem conexão. Confira a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  function set(i: number, v: string) {
    const only = v.replace(/\D/g, "");
    if (only.length > 1) {
      // colou vários números
      const next = only.slice(0, n).split("");
      const full = [...next, ...Array(n - next.length).fill("")];
      setDigits(full);
      refs.current[Math.min(next.length, n - 1)]?.focus();
      if (next.length === n) submit(next.join(""));
      return;
    }
    const next = [...digits];
    next[i] = only;
    setDigits(next);
    if (only && i < n - 1) refs.current[i + 1]?.focus();
    if (only && next.every(Boolean)) submit(next.join(""));
  }

  return (
    <>
      <Welcome firstName={p.firstName} consultant={p.consultant} property={p.property}>
        <p className="mt-2 text-[16px] leading-relaxed text-ink-2">A Auxiliadora Predial precisa de alguns documentos para dar andamento à sua locação. É rápido: você tira as fotos aqui mesmo, pelo celular.</p>
      </Welcome>
      <section className="animate-rise mt-6 rounded-[26px] border border-line bg-surface p-6 shadow-card" style={{ animationDelay: "80ms" }}>
        <div className="mb-4 flex items-center gap-3">
          <span aria-hidden className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <Lock />
          </span>
          <div>
            <h2 className="text-[17px] font-bold tracking-[-0.01em]">Confirme que é você</h2>
            <p className="text-[13px] text-ink-3">Só você deve acessar esta página.</p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="mb-3 block text-[15px] text-ink-2" htmlFor="d0">
            {p.verifyKind === "CPF" ? (
              <>
                Digite os <strong className="text-ink">3 primeiros números do seu CPF</strong>
              </>
            ) : (
              <>
                Digite os <strong className="text-ink">4 últimos números do seu celular</strong>
              </>
            )}
          </label>
          <div className="flex gap-2.5">
            {digits.map((d, i) => (
              <input
                key={i}
                id={`d${i}`}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={d}
                onChange={(e) => set(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={n}
                aria-label={`Número ${i + 1} de ${n}`}
                autoFocus={i === 0}
                disabled={busy || p.locked}
                className="num h-16 w-14 rounded-2xl border-2 border-line-strong bg-surface-2 text-center text-[28px] font-bold transition focus:border-accent focus:bg-surface focus:outline-none disabled:opacity-50"
              />
            ))}
          </div>
          {p.verifyKind === "CPF" && <p className="num mt-2 text-[13px] text-ink-3">Exemplo: no CPF 123.456.789-00, digite 1 2 3.</p>}
          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-bad-soft px-3 py-2 text-[14px] font-semibold text-bad">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={value.length !== n || busy || p.locked}
            className="press mt-5 flex min-h-14 w-full items-center justify-center rounded-full bg-primary text-[16px] font-semibold text-on-primary shadow-float disabled:opacity-40"
          >
            {busy ? "Confirmando…" : "Continuar"}
          </button>
        </form>
      </section>
      <TrustNotes />
    </>
  );
}

function TrustNotes({ retentionDays, expiresAt }: { retentionDays?: number; expiresAt?: string }) {
  const rows: [React.ReactNode, string, string][] = [
    [<Lock key="l" className="size-5" />, "Envio protegido", "A conexão é criptografada e cada arquivo é guardado cifrado."],
    [
      <svg key="u" aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>,
      "Acesso restrito",
      "Só a equipe responsável pela sua locação vê os documentos.",
    ],
    [
      <svg key="t" aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>,
      "Apagados no prazo",
      `Pela LGPD, os arquivos são apagados automaticamente${retentionDays ? ` em até ${retentionDays} dias` : ""}.`,
    ],
  ];
  return (
    <section className="mt-6 rounded-[22px] bg-surface-2 p-5" aria-label="Segurança dos seus dados">
      <ul className="space-y-3.5">
        {rows.map(([icon, title, text]) => (
          <li key={title} className="flex gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-surface text-ink-2 shadow-card">{icon}</span>
            <span>
              <span className="block text-[14px] font-bold">{title}</span>
              <span className="block text-[13px] leading-snug text-ink-3">{text}</span>
            </span>
          </li>
        ))}
      </ul>
      {expiresAt && <p className="mt-4 text-[12px] text-ink-3">Este link vale até {new Date(expiresAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}.</p>}
    </section>
  );
}

/** Reduz fotos grandes no próprio celular antes de enviar (mais rápido, mesma legibilidade). */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 2400;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function upload(token: string, itemKey: string, file: File, onProgress: (p: number) => void): Promise<{ ok: boolean; file?: FileRow; message?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/d/${token}/files`);
    xhr.setRequestHeader("x-requested-with", "visitas");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { file?: FileRow; message?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      resolve(xhr.status >= 200 && xhr.status < 300 ? { ok: true, file: data.file } : { ok: false, message: data.message ?? "Não foi possível enviar. Tente de novo." });
    };
    xhr.onerror = () => resolve({ ok: false, message: "Sem conexão. Confira a internet e tente de novo." });
    const fd = new FormData();
    fd.append("itemKey", itemKey);
    fd.append("file", file);
    xhr.send(fd);
  });
}

export function ClientPortal(p: {
  token: string;
  firstName: string;
  consultant: string | null;
  property: Property;
  message: string | null;
  initialItems: Item[];
  initialStatus: "OPEN" | "SUBMITTED" | "CANCELED";
  expiresAt: string;
  retentionDays: number;
}) {
  const [items, setItems] = useState(p.initialItems);
  const [status, setStatus] = useState(p.initialStatus);
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const done = items.filter((i) => i.files.length > 0).length;
  const missingRequired = items.filter((i) => i.required && i.files.length === 0);
  const uploading = Object.keys(busy).length > 0;
  const pct = Math.round((done / Math.max(1, items.length)) * 100);

  useEffect(() => {
    if (status === "SUBMITTED") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [status]);

  async function pick(item: Item, list: FileList | null) {
    if (!list?.length) return;
    setErrors((e) => ({ ...e, [item.key]: "" }));
    for (const raw of Array.from(list)) {
      const f = await shrink(raw);
      setBusy((b) => ({ ...b, [item.key]: 0 }));
      const r = await upload(p.token, item.key, f, (x) => setBusy((b) => ({ ...b, [item.key]: x })));
      setBusy(({ [item.key]: _omit, ...rest }) => rest);
      if (!r.ok || !r.file) {
        setErrors((e) => ({ ...e, [item.key]: r.message ?? "Não foi possível enviar." }));
        break;
      }
      setItems((all) => all.map((i) => (i.key === item.key ? { ...i, files: [...i.files, r.file!] } : i)));
      try {
        navigator.vibrate?.(10);
      } catch {}
    }
  }

  async function remove(item: Item, f: FileRow) {
    const res = await fetch(`/api/d/${p.token}/files/${f.id}`, { method: "DELETE", headers: H }).catch(() => null);
    if (res?.ok) setItems((all) => all.map((i) => (i.key === item.key ? { ...i, files: i.files.filter((x) => x.id !== f.id) } : i)));
    else setErrors((e) => ({ ...e, [item.key]: "Não foi possível remover agora. Tente de novo." }));
  }

  async function submit() {
    if (missingRequired.length || submitting || uploading) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/d/${p.token}/submit`, { method: "POST", headers: H });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setStatus("SUBMITTED");
      else setSubmitError(data.message ?? "Não foi possível concluir. Tente de novo.");
    } catch {
      setSubmitError("Sem conexão. Seus arquivos já enviados estão guardados — tente concluir de novo.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "SUBMITTED") {
    return (
      <>
        <section className="animate-rise mt-4 rounded-[28px] border border-good/20 bg-surface p-8 text-center shadow-card">
          <span aria-hidden className="animate-pop mx-auto mb-5 grid size-20 place-items-center rounded-full bg-good text-bg shadow-[0_12px_32px_-10px_var(--good)]">
            <Check className="size-10" />
          </span>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.03em]">Documentos recebidos</h1>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
            Obrigado, {p.firstName}! {p.consultant ? `${p.consultant.split(" ")[0]} já foi avisada` : "A equipe já foi avisada"} e vai dar retorno em breve.
          </p>
          <ul className="mt-6 space-y-2 text-left">
            {items
              .filter((i) => i.files.length)
              .map((i) => (
                <li key={i.key} className="flex items-center gap-2.5 rounded-2xl bg-surface-2 px-4 py-3 text-[14px]">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-good text-bg">
                    <Check className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 font-semibold">{i.label}</span>
                  <span className="num text-[12px] text-ink-3">{i.files.length} arq.</span>
                </li>
              ))}
          </ul>
          <p className="mt-6 text-[13px] text-ink-3">Você já pode fechar esta página.</p>
        </section>
        <TrustNotes retentionDays={p.retentionDays} />
      </>
    );
  }

  return (
    <>
      <Welcome firstName={p.firstName} consultant={p.consultant} property={p.property}>
        <p className="mt-2 text-[16px] leading-relaxed text-ink-2">Envie cada documento abaixo. Pode tirar a foto agora ou escolher um arquivo que já tenha no celular.</p>
      </Welcome>

      {p.message && (
        <blockquote className="animate-rise mt-5 rounded-[22px] border border-accent/20 bg-accent-soft px-5 py-4 text-[15px] leading-relaxed text-ink">
          “{p.message}”
          {p.consultant && <span className="mt-1 block text-[13px] font-semibold text-accent-strong">— {p.consultant.split(" ")[0]}</span>}
        </blockquote>
      )}

      <section aria-label="Progresso" className="animate-rise mt-6 flex items-center gap-4 rounded-[22px] border border-line bg-surface px-5 py-4 shadow-card">
        <div className="relative size-14 shrink-0">
          <svg viewBox="0 0 36 36" className="size-14 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--tint-strong)" strokeWidth="3.5" />
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--good)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} className="transition-[stroke-dasharray] duration-700" />
          </svg>
          <span className="num absolute inset-0 grid place-items-center text-[13px] font-bold">{pct}%</span>
        </div>
        <div>
          <p className="text-[16px] font-bold">
            {done} de {items.length} {items.length === 1 ? "documento enviado" : "documentos enviados"}
          </p>
          <p className="text-[13px] text-ink-3">{missingRequired.length ? `Faltam ${missingRequired.length} obrigatório${missingRequired.length === 1 ? "" : "s"}.` : "Tudo pronto para concluir."}</p>
        </div>
      </section>

      <ol className="mt-5 space-y-3.5">
        {items.map((item, idx) => (
          <ItemCard key={item.key} n={idx + 1} item={item} progress={busy[item.key]} error={errors[item.key]} onPick={(l) => pick(item, l)} onRemove={(f) => remove(item, f)} />
        ))}
      </ol>

      <TrustNotes retentionDays={p.retentionDays} expiresAt={p.expiresAt} />

      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-bg via-bg/95 to-bg/0 px-5 pt-8 pb-4">
        <div className="mx-auto max-w-lg">
          {submitError && (
            <p role="alert" className="mb-2 rounded-xl bg-bad-soft px-3 py-2 text-[13px] font-semibold text-bad">
              {submitError}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={missingRequired.length > 0 || submitting || uploading}
            className="press flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-[16px] font-semibold text-on-primary shadow-float disabled:opacity-40"
          >
            {submitting ? "Enviando…" : uploading ? "Aguarde o envio terminar…" : missingRequired.length ? `Faltam ${missingRequired.length} documento${missingRequired.length === 1 ? "" : "s"}` : "Concluir envio"}
          </button>
        </div>
      </div>
    </>
  );
}

function ItemCard({ n, item, progress, error, onPick, onRemove }: { n: number; item: Item; progress?: number; error?: string; onPick: (l: FileList | null) => void; onRemove: (f: FileRow) => void }) {
  const cam = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const has = item.files.length > 0;
  const id = useMemo(() => `item-${item.key}`, [item.key]);
  return (
    <li className={cx("animate-rise rounded-[24px] border bg-surface p-5 shadow-card transition-colors", has ? "border-good/30" : "border-line")} aria-labelledby={id}>
      <div className="flex items-start gap-3.5">
        <span aria-hidden className={cx("num grid size-9 shrink-0 place-items-center rounded-full text-[14px] font-bold transition-colors", has ? "bg-good text-bg" : "bg-tint text-ink-2")}>
          {has ? <Check /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={id} className="text-[16px] leading-snug font-bold">
            {item.label}
            {!item.required && <span className="ml-2 align-middle text-[11px] font-bold tracking-wide text-ink-3 uppercase">opcional</span>}
          </h3>
          {item.hint && <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{item.hint}</p>}
        </div>
      </div>

      {item.files.length > 0 && (
        <ul className="mt-3.5 space-y-2">
          {item.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3.5 py-2.5">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface text-[11px] font-bold text-ink-3 shadow-card">{f.mime === "application/pdf" ? "PDF" : "FOTO"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{f.name}</span>
                <span className="num text-[12px] text-ink-3">{sizeLabel(f.size)} · enviado</span>
              </span>
              <button type="button" onClick={() => onRemove(f)} aria-label={`Remover ${f.name}`} className="press grid size-10 place-items-center rounded-full text-ink-3 hover:bg-tint hover:text-bad">
                <svg aria-hidden viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {progress !== undefined && (
        <div className="mt-3.5" role="status">
          <div className="mb-1 flex justify-between text-[12px] font-semibold text-ink-2">
            <span>Enviando com segurança…</span>
            <span className="num">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-tint">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(6, progress * 100)}%` }} />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-bad-soft px-3 py-2 text-[13px] font-semibold text-bad">
          {error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={() => cam.current?.click()} disabled={progress !== undefined} className="press flex min-h-12 items-center justify-center gap-2 rounded-full bg-accent text-[14px] font-semibold text-white disabled:opacity-50">
          <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          {has ? "Outra foto" : "Tirar foto"}
        </button>
        <button type="button" onClick={() => file.current?.click()} disabled={progress !== undefined} className="press flex min-h-12 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface text-[14px] font-semibold disabled:opacity-50">
          <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4m0 0-4 4m4-4 4 4M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />
          </svg>
          Escolher arquivo
        </button>
      </div>
      <input
        ref={cam}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={file}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
      />
    </li>
  );
}
