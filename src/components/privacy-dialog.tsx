"use client";
import { useState } from "react";
import Link from "next/link";
import { acceptPrivacyAction } from "@/app/actions/auth";

/** Ciência do aviso de privacidade (uma vez por pessoa; fica registrada). */
export function PrivacyDialog({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function accept() {
    setBusy(true);
    setError(false);
    try {
      const r = await acceptPrivacyAction();
      if (r.ok) return window.location.replace("/");
      window.location.replace("/login");
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1f2124]/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="pv-title">
      <div className="w-full max-w-md rounded-3xl bg-surface p-6 shadow-float sm:p-8">
        <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase">Privacidade (LGPD)</p>
        <h2 id="pv-title" className="text-[24px] leading-tight font-bold tracking-[-0.03em]">
          {name.split(" ")[0]}, um aviso rápido
        </h2>
        <ul className="mt-4 mb-6 list-disc space-y-2 pl-5 text-sm text-ink-2">
          <li>O app guarda nome, telefone e observações de clientes só para o atendimento e os indicadores da equipe.</li>
          <li>
            <strong className="text-ink">Não registre documentos</strong> (CPF, RG), dados de saúde ou financeiros nas observações.
          </li>
          <li>Clientes podem pedir a exclusão dos dados; a gestão faz isso pelo app.</li>
        </ul>
        <div className="flex flex-col gap-3">
          {error && <p role="alert" className="text-sm font-semibold text-bad">Não foi possível registrar. Verifique a conexão e tente de novo.</p>}
          <button type="button" onClick={accept} disabled={busy} className="min-h-12 rounded-full bg-primary px-6 font-semibold text-on-primary disabled:opacity-60">
            {busy ? "Registrando…" : "Li e estou de acordo"}
          </button>
          <Link href="/privacidade" className="text-center text-sm font-semibold text-ink-2 underline underline-offset-4">
            Ler o aviso completo
          </Link>
        </div>
      </div>
    </div>
  );
}
