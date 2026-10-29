"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Select, Textarea } from "@/components/ui";
import { closeCaptureRequestAction, requestCaptureAction } from "@/app/actions/capture";

/** "Pedir à captação": o que o cliente procura (vai junto com o perfil; nome e telefone não). */
export function RequestCaptureForm({ searchId, initial, again }: { searchId: string; initial: string; again?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="press inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-[14px] font-semibold text-on-primary">
        {again ? "Pedir de novo à captação" : "Pedir à captação"}
      </button>
    );
  return (
    <ActionForm action={requestCaptureAction} className="rounded-2xl border border-line bg-surface-2 p-3">
      {(s) => (
        <>
          <input type="hidden" name="searchId" value={searchId} />
          <label htmlFor="cap-wants" className="mb-1 block text-[13px] font-semibold">
            O que o cliente procura?
          </label>
          <Textarea id="cap-wants" name="wants" rows={3} maxLength={1500} defaultValue={initial} placeholder="Ex.: casa com pátio para 2 cachorros, perto de escola; aceita até R$ 2.500 com condomínio." />
          {s.fieldErrors?.wants && <p className="mt-1 text-[13px] font-semibold text-bad">{s.fieldErrors.wants}</p>}
          <p className="mt-1 text-[12px] text-ink-3">Vai junto o perfil acima (bairro, tipo, quartos, valor). Nome e telefone do cliente não vão para a captação.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <SubmitButton>Enviar à captação</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="press min-h-11 rounded-full px-4 text-[14px] font-semibold text-ink-2">
              Voltar
            </button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Encerrar o pedido à captação (cliente não precisa mais). */
export function CloseCaptureForm({ id, reasons }: { id: string; reasons: string[] }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="press mt-2 inline-flex min-h-9 items-center text-[13px] font-semibold text-ink-3 hover:text-ink">
        Encerrar pedido à captação
      </button>
    );
  return (
    <ActionForm action={closeCaptureRequestAction} className="mt-3 rounded-2xl border border-line bg-surface-2 p-3">
      {() => (
        <>
          <input type="hidden" name="id" value={id} />
          <label htmlFor="cap-reason" className="mb-1 block text-[13px] font-semibold">
            Como terminou?
          </label>
          <Select id="cap-reason" name="reason" required defaultValue="">
            <option value="" disabled>
              Escolha
            </option>
            {reasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
          <div className="mt-3 flex flex-wrap gap-2">
            <SubmitButton variant="secondary">Encerrar</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="press min-h-11 rounded-full px-4 text-[14px] font-semibold text-ink-2">
              Voltar
            </button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
