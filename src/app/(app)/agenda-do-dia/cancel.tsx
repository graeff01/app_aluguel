"use client";
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Input, Select, Textarea } from "@/components/ui";
import { cancelVisitAction, reopenVisitAction, setCancelReasonAction, swapPropertyAction } from "@/app/actions/visits";

/** Pré-atendimento: cancelar a visita escolhendo o motivo (a consultora é avisada). */
export function CancelVisit({ visitId, label, reasons, code, others = [], back }: { visitId: string; label: string; reasons: { id: string; label: string }[]; code?: string | null; others?: string[]; back: string }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"one" | "all">("one");
  // o que estava na tela ao abrir: se a agenda mudar a visita (atualização automática), o servidor recusa e pede para conferir
  const [seen, setSeen] = useState<{ code: string; others: string[] } | null>(null);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setSeen({ code: code ?? "", others: others.map((o) => (o === "sem código" ? "" : o)) });
          setOpen(true);
        }}
        className="press min-h-9 rounded-full border border-bad/30 px-3 text-[12px] font-semibold text-bad hover:bg-bad-soft">
        Cancelar
      </button>
    );
  }
  return (
    <ActionForm action={cancelVisitAction} className="mt-2 w-full rounded-2xl border border-bad/25 bg-bad-soft/40 p-3">
      {(s) => (
        <>
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="back" value={back} />
          {seen && (
            <>
              <input type="hidden" name="seenCode" value={seen.code} />
              <input type="hidden" name="seenOthers" value={seen.others.join(",")} />
            </>
          )}
          <p className="mb-2 text-[13px] font-semibold">Cancelar a visita de {label}?</p>
          {others.length > 0 && (
            <fieldset className="mb-2 grid gap-1.5 text-[13px]">
              <legend className="sr-only">O que cancelar</legend>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="scope" value="one" checked={scope === "one"} onChange={() => setScope("one")} className="size-4 accent-[var(--bad)]" />
                Só o imóvel <strong className="num">{code ?? "deste cartão"}</strong> (os outros continuam)
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="scope" value="all" checked={scope === "all"} onChange={() => setScope("all")} className="size-4 accent-[var(--bad)]" />
                Todos os {others.length + 1} imóveis desta visita
              </label>
            </fieldset>
          )}
          <label className="sr-only" htmlFor={`reason-${visitId}`}>
            Motivo do cancelamento
          </label>
          <Select id={`reason-${visitId}`} name="reasonId" required defaultValue="">
            <option value="" disabled>
              Motivo do cancelamento
            </option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <FieldError state={s} name="reasonId" />
          <label className="sr-only" htmlFor={`note-${visitId}`}>
            Observação
          </label>
          <Textarea id={`note-${visitId}`} name="note" maxLength={500} placeholder="Observação (obrigatória se o motivo for Outro)" className="mt-2 min-h-16" />
          <FieldError state={s} name="note" />
          <div className="mt-2 flex flex-wrap gap-2">
            <SubmitButton variant="danger">Cancelar visita</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="press min-h-11 rounded-full px-4 text-[14px] font-semibold text-ink-2">
              Voltar
            </button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Visita cancelada sem motivo (pela consultora ou pela agenda Google): informar o motivo depois. */
export function CancelReason({ visitId, reasons }: { visitId: string; reasons: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="press min-h-9 rounded-full border border-line-strong px-3 text-[12px] font-semibold text-ink-2 hover:bg-tint">
        Informar motivo
      </button>
    );
  }
  return (
    <ActionForm action={setCancelReasonAction} className="mt-2 w-full rounded-2xl border border-line bg-surface-2 p-3">
      {(s) => (
        <>
          <input type="hidden" name="visitId" value={visitId} />
          <label className="sr-only" htmlFor={`creason-${visitId}`}>
            Motivo do cancelamento
          </label>
          <Select id={`creason-${visitId}`} name="reasonId" required defaultValue="">
            <option value="" disabled>
              Motivo do cancelamento
            </option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <FieldError state={s} name="reasonId" />
          <label className="sr-only" htmlFor={`cnote-${visitId}`}>
            Observação
          </label>
          <Textarea id={`cnote-${visitId}`} name="note" maxLength={500} placeholder="Observação (obrigatória se o motivo for Outro)" className="mt-2 min-h-16" />
          <FieldError state={s} name="note" />
          <div className="mt-2 flex flex-wrap gap-2">
            <SubmitButton>Salvar motivo</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="press min-h-11 rounded-full px-4 text-[14px] font-semibold text-ink-2">
              Voltar
            </button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Reabrir visita cancelada por engano (depois dos 2 minutos do "Desfazer"), com o motivo no histórico. */
export function ReopenVisit({ visitId, code }: { visitId: string; code?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="press min-h-9 rounded-full border border-line-strong px-3 text-[12px] font-semibold text-ink-2 hover:bg-tint">
        Reabrir
      </button>
    );
  }
  return (
    <ActionForm action={reopenVisitAction} className="mt-2 w-full rounded-2xl border border-line-strong bg-surface-2 p-3">
      {(s) => (
        <>
          <input type="hidden" name="visitId" value={visitId} />
          <p className="mb-2 text-[13px] font-semibold">Reabrir a visita{code ? ` do imóvel ${code}` : ""}? Ela volta a agendada e a consultora é avisada.</p>
          <label className="sr-only" htmlFor={`reopen-${visitId}`}>
            Por que reabrir
          </label>
          <Textarea id={`reopen-${visitId}`} name="note" maxLength={300} required placeholder="Por que reabrir (ex.: cancelada por engano)" className="min-h-16" />
          <FieldError state={s} name="note" />
          <div className="mt-2 flex flex-wrap gap-2">
            <SubmitButton>Reabrir visita</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="press min-h-11 rounded-full px-4 text-[14px] font-semibold text-ink-2">
              Voltar
            </button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/**
 * Imóvel indisponível, cliente quer ver outro no mesmo horário: o imóvel antigo fica "trocado" (não conta como
 * cancelamento do cliente) e o novo entra na visita. A consultora é avisada.
 */
export function SwapProperty({ visitId, code, reasons }: { visitId: string; code: string; reasons: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  // motivo mais comum já escolhido (imóvel alugado / indisponível)
  const usual = reasons.find((r) => /alugad|indispon/i.test(r.label))?.id ?? "";
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="press min-h-9 rounded-full border border-line-strong px-3 text-[12px] font-semibold text-ink-2 hover:bg-tint">
        Trocar imóvel
      </button>
    );
  }
  return (
    <ActionForm action={swapPropertyAction} className="mt-2 w-full rounded-2xl border border-line-strong bg-surface-2 p-3">
      {(s) => (
        <>
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="seenCode" value={code} />
          <p className="mb-2 text-[13px] font-semibold">
            Trocar o imóvel <span className="num">{code}</span> por outro, no mesmo horário? O cliente não fica como cancelado.
          </p>
          <label className="mb-1 block text-[12px] font-semibold text-ink-2" htmlFor={`swap-code-${visitId}`}>
            Código do novo imóvel
          </label>
          <Input
            id={`swap-code-${visitId}`}
            name="newCode"
            required
            inputMode="numeric"
            autoComplete="off"
            maxLength={40}
            className="num"
          />
          <FieldError state={s} name="newCode" />
          <label className="mb-1 mt-2 block text-[12px] font-semibold text-ink-2" htmlFor={`swap-reason-${visitId}`}>
            Por que o imóvel {code} saiu
          </label>
          <Select id={`swap-reason-${visitId}`} name="reasonId" required defaultValue={usual}>
            <option value="" disabled>
              Motivo
            </option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <FieldError state={s} name="reasonId" />
          <label className="sr-only" htmlFor={`swap-note-${visitId}`}>
            Observação
          </label>
          <Textarea id={`swap-note-${visitId}`} name="note" maxLength={300} placeholder="Observação (opcional)" className="mt-2 min-h-14" />
          <FieldError state={s} name="note" />
          <div className="mt-2 flex flex-wrap gap-2">
            <SubmitButton>Trocar imóvel</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="press min-h-11 rounded-full px-4 text-[14px] font-semibold text-ink-2">
              Voltar
            </button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
