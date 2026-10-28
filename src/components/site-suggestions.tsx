"use client";
/* eslint-disable @next/next/no-img-element */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { optionsSentAction, rejectSuggestionAction } from "@/app/actions/radar";
import { REJECT_REASONS, type RejectReason } from "@/lib/reject-reasons";
import { optionsMessage, whatsappUrl, type OptionItem } from "@/lib/options-message";
import { cx } from "./ui";

export type Suggestion = OptionItem & { photoUrl: string | null; reasons: string[]; isNew: boolean };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Opções do site para o cliente: marque até 3 e envie pelo WhatsApp com a mensagem pronta (links dos anúncios),
 * ou só registre que indicou. Tudo fica no histórico do pedido.
 */
export function SiteSuggestions({ kind, id, items, phone, clientName, senderName }: { kind: "radar" | "search"; id: string; items: Suggestion[]; phone: string | null; clientName: string; senderName: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const chosen = items.filter((i) => picked.includes(i.code));
  const toggle = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : p.length >= 3 ? p : [...p, code]));
  const record = (via: "whatsapp" | "manual") =>
    start(async () => {
      const r = await optionsSentAction(kind, id, picked, via);
      setMsg({ ok: r.ok, text: r.message ?? (r.ok ? "Registrado." : "Não foi possível registrar.") });
      if (r.ok) {
        setPicked([]);
        router.refresh();
      }
    });
  const send = () => {
    if (!phone || !chosen.length) return;
    // abre o WhatsApp na hora do toque (o navegador bloqueia janela aberta depois de esperar o servidor)
    window.open(whatsappUrl(phone, optionsMessage(clientName, senderName, chosen)), "_blank", "noopener,noreferrer");
    record("whatsapp");
  };
  return (
    <div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => {
          const on = picked.includes(it.code);
          const price = it.totalCents ?? it.rentCents;
          return (
            <li key={it.code} className={cx("overflow-hidden rounded-2xl border bg-surface transition", on ? "border-accent ring-2 ring-accent/30" : "border-line")}>
              {it.photoUrl && (
                <div className="relative aspect-[16/9] bg-tint">
                  <img src={it.photoUrl} alt={`Imóvel ${it.code}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />
                  {it.isNew && <span className="absolute top-2 left-2 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-white shadow">Novo no site</span>}
                </div>
              )}
              <div className="p-3">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="num text-[13px] font-bold">
                    Imóvel {it.code}
                    {it.isNew && !it.photoUrl && <span className="ml-1.5 rounded-full bg-accent px-2 py-px text-[11px] text-white">novo</span>}
                  </span>
                  {price ? <span className="num text-[15px] font-bold">{brl(price)}</span> : null}
                </p>
                <p className="text-[13px] text-ink-2">
                  {[it.category, it.neighborhood, it.bedrooms ? `${it.bedrooms} quarto${it.bedrooms > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ")}
                  {it.totalCents && it.rentCents && it.totalCents !== it.rentCents ? <span className="text-ink-3"> · aluguel {brl(it.rentCents)}</span> : null}
                </p>
                {it.reasons.length > 0 && <p className="mt-1 text-[12px] font-semibold text-good">✓ {it.reasons.join(" · ")}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className={cx("press inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] font-semibold", on ? "border-accent bg-accent-soft text-accent-strong" : "border-line-strong")}>
                    <input type="checkbox" checked={on} onChange={() => toggle(it.code)} className="size-4 accent-[var(--accent)]" />
                    {on ? "Escolhida" : "Escolher"}
                  </label>
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-9 items-center rounded-full border border-line-strong px-3 text-[13px] font-semibold">
                    Ver anúncio ↗
                  </a>
                  {rejecting !== it.code && (
                    <button type="button" onClick={() => setRejecting(it.code)} className="press inline-flex min-h-9 items-center rounded-full px-3 text-[13px] font-semibold text-ink-3 hover:bg-tint hover:text-ink">
                      Fora do perfil
                    </button>
                  )}
                </div>
                {rejecting === it.code && <RejectForm kind={kind} id={id} item={it} onDone={(text) => { setRejecting(null); setMsg({ ok: true, text }); setPicked((p) => p.filter((c) => c !== it.code)); router.refresh(); }} onCancel={() => setRejecting(null)} />}
              </div>
            </li>
          );
        })}
      </ul>
      <div className={cx("sticky bottom-24 z-10 mt-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-float backdrop-blur md:bottom-4", !picked.length && "hidden")}>
        <p className="mb-2 text-[13px] font-semibold">
          {picked.length} {picked.length === 1 ? "opção escolhida" : "opções escolhidas"} <span className="font-normal text-ink-3">(até 3)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {phone ? (
            <button type="button" disabled={pending} onClick={send} className="press inline-flex min-h-11 items-center rounded-full bg-[#1fa855] px-5 text-[14px] font-semibold text-white disabled:opacity-50">
              Enviar pelo WhatsApp
            </button>
          ) : (
            <span className="self-center text-[13px] text-ink-3">Sem telefone para o WhatsApp.</span>
          )}
          <button type="button" disabled={pending} onClick={() => record("manual")} className="press inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-[14px] font-semibold disabled:opacity-50">
            Só registrar que indiquei
          </button>
        </div>
      </div>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={cx("mt-3 text-sm font-semibold", msg.ok ? "text-good" : "text-bad")}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

/** Motivo de "fora do perfil": tira a opção deste cliente e ajusta as próximas sugestões. */
function RejectForm({ kind, id, item, onDone, onCancel }: { kind: "radar" | "search"; id: string; item: Suggestion; onDone: (text: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState<RejectReason | "">("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await rejectSuggestionAction(kind, id, {
        reason,
        note,
        listing: { code: item.code, category: item.category, neighborhood: item.neighborhood, bedrooms: item.bedrooms, priceCents: item.totalCents ?? item.rentCents },
      });
      if (r.ok) onDone(r.message ?? "Fora do perfil.");
      else setErr(r.fieldErrors?.note ?? r.fieldErrors?.reason ?? r.message ?? "Não foi possível salvar.");
    });
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
      <p className="mb-2 text-[13px] font-semibold">Por que não serve para este cliente?</p>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(REJECT_REASONS) as RejectReason[]).map((k) => (
          <button key={k} type="button" onClick={() => setReason(k)} aria-pressed={reason === k} className={cx("press min-h-9 rounded-full border px-3 text-[12px] font-semibold", reason === k ? "border-accent bg-accent-soft text-accent-strong" : "border-line-strong")}>
            {REJECT_REASONS[k]}
          </button>
        ))}
      </div>
      {reason && (
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={reason === "OTHER" ? "Qual o motivo? (obrigatório)" : "Observação (opcional)"} className="mt-2 block min-h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-[14px]" />
      )}
      {err && <p className="mt-2 text-[13px] font-semibold text-bad">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={!reason || pending} onClick={save} className="press min-h-9 rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary disabled:opacity-40">
          Salvar
        </button>
        <button type="button" onClick={onCancel} className="press min-h-9 rounded-full px-3 text-[13px] font-semibold text-ink-2">
          Voltar
        </button>
      </div>
    </div>
  );
}
