"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useOnline } from "@/components/online-status";
import { cx } from "@/components/ui";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";

type Status = "DONE" | "NO_SHOW" | "CANCELED" | "RESCHEDULED";
type Evaluation = "POSITIVE" | "NEGATIVE" | "UNDECIDED";

type Props = {
  visitId: string;
  version: number;
  missingData: string[];
  canCorrect: boolean;
  noteMax: number;
  reasons: { id: string; label: string }[];
  initial: { status: Status | null; evaluation: Evaluation | null; negativeReasonId: string | null; note: string };
  isEdit: boolean;
  future: boolean;
};

const STATUS_OPTIONS: { value: Status; label: string; hint?: string }[] = [
  { value: "DONE", label: "Sim, aconteceu" },
  { value: "NO_SHOW", label: "Cliente não compareceu" },
  { value: "CANCELED", label: "Cancelada" },
  { value: "RESCHEDULED", label: "Remarcada", hint: "A nova data deve ser agendada na agenda central." },
];
const EVAL_OPTIONS: { value: Evaluation; label: string; hint: string }[] = [
  { value: "POSITIVE", label: "Positiva", hint: "Cliente quer avançar (ainda não é contrato fechado)" },
  { value: "NEGATIVE", label: "Negativa", hint: "Cliente não quer este imóvel" },
  { value: "UNDECIDED", label: "Ainda decidindo", hint: "Cliente vai pensar" },
];

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string; fields?: Record<string, string> }
  | { kind: "conflict"; message: string; current?: { status: string; evaluation: string | null; note: string | null; concludedBy: string | null; version: number } }
  | { kind: "saved" };

export function OutcomeForm(p: Props) {
  const router = useRouter();
  const online = useOnline();
  const [status, setStatus] = useState<Status | null>(p.initial.status);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(p.initial.evaluation);
  const [reasonId, setReasonId] = useState<string>(p.initial.negativeReasonId ?? "");
  const [note, setNote] = useState(p.initial.note);
  const [version, setVersion] = useState(p.version);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  // chave de idempotência estável enquanto a tela estiver aberta (retry não duplica)
  const requestId = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), []);
  const inFlight = useRef(false);
  const dirty = note.trim() !== p.initial.note.trim() || status !== p.initial.status || evaluation !== p.initial.evaluation;

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty && save.kind !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, save.kind]);

  const blockedByData = status === "DONE" && p.missingData.length > 0;
  const trimmed = note.trim();
  const problems: string[] = [];
  if (!status) problems.push("Informe se a visita aconteceu.");
  if (status === "DONE" && !evaluation) problems.push("Selecione o resultado.");
  if (status === "DONE" && evaluation === "NEGATIVE" && !reasonId) problems.push("Selecione o motivo principal.");
  if (!trimmed) problems.push("Escreva a observação.");
  if (note.length > p.noteMax) problems.push(`A observação passou de ${p.noteMax} caracteres.`);
  if (blockedByData) problems.push("Complete os dados da visita.");
  if (status && (status === "DONE" || status === "NO_SHOW") && p.future) problems.push("A visita ainda não começou.");
  const ready = problems.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/visits/${p.visitId}/outcome`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "visitas" },
        body: JSON.stringify({
          requestId,
          expectedVersion: version,
          status,
          evaluation: status === "DONE" ? evaluation : null,
          negativeReasonId: status === "DONE" && evaluation === "NEGATIVE" ? reasonId : null,
          note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSave({ kind: "saved" });
        if (data.next?.id && !p.isEdit) {
          // vai direto para a próxima pendente
          router.replace(`/visitas/${data.next.id}/registrar?anterior=salvo&restantes=${data.next.remaining}`);
          router.refresh();
          return;
        }
        router.replace(`/visitas/${p.visitId}?salvo=1`);
        router.refresh();
        return;
      }
      if (res.status === 409 && data.error === "CONFLICT") {
        const cur = await fetch(`/api/visits/${p.visitId}/state`, { headers: { "x-requested-with": "visitas" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        setSave({ kind: "conflict", message: data.message, current: cur ?? undefined });
        return;
      }
      if (res.status === 401) {
        setSave({ kind: "error", message: "Sua sessão expirou. Copie sua observação, entre novamente e registre de novo." });
        return;
      }
      setSave({ kind: "error", message: data.message ?? "Não foi possível salvar.", fields: data.details });
    } catch {
      setSave({ kind: "error", message: "Sem conexão com o servidor. Nada foi salvo. Seu texto continua aqui — tente de novo quando a internet voltar." });
    } finally {
      inFlight.current = false;
    }
  }

  const saving = save.kind === "saving" || save.kind === "saved";

  return (
    <form onSubmit={submit} noValidate className="pb-24">
      <fieldset className="mb-6">
        <legend className="mb-3 text-[17px] font-bold tracking-[-0.02em]">A visita aconteceu?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {STATUS_OPTIONS.map((o) => (
            <Choice key={o.value} name="status" value={o.value} checked={status === o.value} onChange={() => setStatus(o.value)} label={o.label} hint={o.hint} />
          ))}
        </div>
      </fieldset>

      {status === "DONE" && blockedByData && (
        <div role="alert" className="mb-6 rounded-2xl border border-accent/25 bg-accent-soft p-4">
          <p className="font-semibold text-ink">Faltam dados para concluir como realizada: {p.missingData.join(" e ")}.</p>
          {p.canCorrect ? (
            <Link href={`/visitas/${p.visitId}/corrigir?voltar=registrar`} className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary underline">
              Completar dados da visita
            </Link>
          ) : (
            <p className="mt-1 text-ink">Peça à gestão para completar os dados.</p>
          )}
        </div>
      )}

      {status === "DONE" && (
        <fieldset className="mb-6">
          <legend className="mb-3 text-[17px] font-bold tracking-[-0.02em]">Resultado da visita</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {EVAL_OPTIONS.map((o) => (
              <Choice key={o.value} name="evaluation" value={o.value} checked={evaluation === o.value} onChange={() => setEvaluation(o.value)} label={o.label} hint={o.hint} />
            ))}
          </div>
        </fieldset>
      )}

      {status === "DONE" && evaluation === "NEGATIVE" && (
        <fieldset className="mb-6">
          <legend className="mb-3 text-[17px] font-bold tracking-[-0.02em]">Motivo principal</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {p.reasons.map((r) => (
              <Choice key={r.id} name="reason" value={r.id} checked={reasonId === r.id} onChange={() => setReasonId(r.id)} label={r.label} compact />
            ))}
          </div>
        </fieldset>
      )}

      <div className="mb-4">
        <label htmlFor="note" className="mb-2 block text-[17px] font-bold tracking-[-0.02em]">
          Observação <span className="text-base font-normal text-ink-3">(obrigatória)</span>
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={p.noteMax + 200}
          aria-describedby="note-help"
          aria-invalid={note.length > p.noteMax || !!(save.kind === "error" && save.fields?.note)}
          placeholder="O que o cliente disse? Ex.: gostou da localização, achou o condomínio alto."
          className="block min-h-36 w-full rounded-2xl border border-line-strong bg-surface px-4 py-3.5 text-[15px] shadow-card transition focus:border-ink focus:shadow-[0_0_0_4px_rgb(29_32_35/0.06)] focus:outline-none aria-[invalid=true]:border-bad"
        />
        <p id="note-help" className={cx("num mt-1.5 text-right text-[13px]", note.length > p.noteMax ? "font-semibold text-bad" : "text-ink-3")}>
          {note.length}/{p.noteMax}
        </p>
      </div>

      {!online && (
        <p role="status" className="mb-3 rounded-2xl bg-warn-soft p-4 text-sm text-warn">
          Você está sem conexão. Salvar exige internet; o texto fica nesta tela enquanto ela estiver aberta (não é guardado se fechar ou recarregar).
        </p>
      )}
      {save.kind === "error" && (
        <div role="alert" className="mb-3 rounded-2xl border border-bad/20 bg-bad-soft p-4 text-sm text-bad">
          <p className="font-semibold">Não salvo</p>
          <p>{save.message}</p>
        </div>
      )}
      {save.kind === "conflict" && (
        <div role="alert" className="mb-3 rounded-2xl border border-accent/25 bg-accent-soft p-4 text-sm text-ink">
          <p className="font-semibold">Não salvo — a visita foi alterada por outra pessoa</p>
          <p>{save.message}</p>
          {save.current && (
            <p className="mt-2 text-sm">
              Versão atual: <strong>{STATUS_LABEL[save.current.status] ?? save.current.status}</strong>
              {save.current.evaluation ? ` / ${EVALUATION_LABEL[save.current.evaluation]}` : ""}
              {save.current.concludedBy ? `, por ${save.current.concludedBy}` : ""}
              {save.current.note ? ` — “${save.current.note.slice(0, 140)}”` : ""}
            </p>
          )}
          {save.current && (
            <button
              type="button"
              className="mt-2 min-h-11 font-semibold text-primary underline"
              onClick={() => {
                setVersion(save.current!.version);
                setSave({ kind: "idle" });
              }}
            >
              Revisei a versão atual — substituir pelo que escrevi
            </button>
          )}
        </div>
      )}
      {!ready && save.kind === "idle" && (status || trimmed) && (
        <ul className="mb-3 space-y-0.5 text-[13px] text-ink-3">
          {problems.map((x) => (
            <li key={x}>• {x}</li>
          ))}
        </ul>
      )}

      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-bg via-bg/95 to-bg/0 px-4 pt-6 md:static md:bg-none md:p-0">
        <button
          type="submit"
          disabled={!ready || saving || save.kind === "conflict"}
          className="mx-auto flex min-h-14 w-full max-w-md items-center justify-center gap-2 rounded-full bg-primary text-[16px] font-semibold text-white shadow-float transition active:scale-[0.98] disabled:opacity-40 md:mx-0 md:max-w-xs"
        >
          {save.kind === "saving" ? "Salvando…" : save.kind === "saved" ? "Salvo ✓" : save.kind === "error" ? "Tentar novamente" : p.isEdit ? "Salvar alteração" : "Salvar resultado"}
        </button>
      </div>
    </form>
  );
}

function Choice({ name, value, checked, onChange, label, hint, compact }: { name: string; value: string; checked: boolean; onChange: () => void; label: string; hint?: string; compact?: boolean }) {
  return (
    <label
      className={cx(
        "relative flex cursor-pointer items-center gap-3.5 rounded-2xl border px-4 transition-[border,box-shadow,background]",
        compact ? "min-h-13 py-3" : "min-h-16 py-3.5",
        checked ? "border-primary bg-primary text-white shadow-float" : "border-line bg-surface shadow-card hover:border-line-strong",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden
        className={cx("grid size-5 shrink-0 place-items-center rounded-full border-2", checked ? "border-accent bg-accent" : "border-line-strong")}
      >
        {checked && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint && <span className={cx("block text-[13px]", checked ? "text-white/65" : "text-ink-3")}>{hint}</span>}
      </span>
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
    </label>
  );
}
