"use client";
import { useState } from "react";
import { Input } from "@/components/ui";

/** "Achei imóvel" da demonstração: mostra o que aconteceria, sem gravar nada. */
export function DemoFoundForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  if (sent)
    return (
      <p role="status" className="mt-3 rounded-2xl bg-good-soft px-3 py-2 text-[13px] font-semibold text-good">
        ✓ No app de verdade: o imóvel {sent} entra neste pedido e o pré-atendimento recebe um aviso na hora para oferecer ao cliente. (Demonstração: nada foi enviado.)
      </p>
    );
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="press mt-3 inline-flex min-h-10 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary">
        Achei imóvel
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get("codes") ?? "").trim();
        if (code) setSent(code);
      }}
      className="mt-3 rounded-2xl border border-line bg-surface-2 p-3"
    >
      <label htmlFor={`codes-${id}`} className="mb-1 block text-[13px] font-semibold">
        Código do imóvel <span className="font-normal text-ink-3">(vários: separe com ;)</span>
      </label>
      <Input id={`codes-${id}`} name="codes" required inputMode="numeric" autoComplete="off" placeholder="734999" />
      <label htmlFor={`note-${id}`} className="mt-2 mb-1 block text-[13px] font-semibold">
        Observação <span className="font-normal text-ink-3">(opcional)</span>
      </label>
      <Input id={`note-${id}`} name="note" maxLength={500} placeholder="Ex.: entra no site amanhã; proprietário aceita pet" />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className="press inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-[14px] font-semibold text-on-primary">
          Enviar ao pré-atendimento
        </button>
        <button type="button" onClick={() => setOpen(false)} className="press min-h-11 rounded-full px-4 text-[14px] font-semibold text-ink-2">
          Voltar
        </button>
      </div>
    </form>
  );
}
