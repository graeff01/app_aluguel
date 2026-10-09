"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "./action-form";
import { setPropertyAddressAction } from "@/app/actions/property";

/** Endereço do imóvel (para a rota). Fica salvo no imóvel e vale para as próximas visitas. */
export function AddressEditor({ code, address, compact }: { code: string; address: string | null; compact?: boolean }) {
  const [open, setOpen] = useState(!address && !compact);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-10 text-[13px] font-semibold text-ink-2 underline underline-offset-4">
        {address ? "Corrigir endereço" : "Informar endereço"}
      </button>
    );
  }
  return (
    <ActionForm action={setPropertyAddressAction} className="mt-2">
      {(st) => (
        <>
          <input type="hidden" name="code" value={code} />
          <label htmlFor={`addr-${code}`} className="mb-1.5 block text-[13px] font-semibold text-ink-2">
            Endereço do imóvel {code}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={`addr-${code}`}
              name="address"
              defaultValue={address ?? ""}
              placeholder="Rua, número, bairro"
              autoComplete="off"
              className="min-h-12 flex-1 rounded-2xl border border-line-strong bg-surface px-4 text-[15px] focus:border-ink focus:outline-none"
            />
            <SubmitButton variant="secondary" className="min-h-12 px-5">
              Salvar
            </SubmitButton>
          </div>
          {st.fieldErrors?.address && <p className="mt-1.5 text-[13px] font-semibold text-bad">{st.fieldErrors.address}</p>}
          <p className="mt-1.5 text-[12px] text-ink-3">Fica salvo no imóvel e vale para as próximas visitas. Só o endereço do imóvel vai para o mapa.</p>
        </>
      )}
    </ActionForm>
  );
}
