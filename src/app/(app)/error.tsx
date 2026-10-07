"use client";
import { Button } from "@/components/ui";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-bad/30 bg-surface p-6">
      <h1 className="text-lg font-semibold">Não foi possível carregar esta tela</h1>
      <p className="mt-1 text-ink-2">Verifique sua conexão e tente novamente. Seus registros já salvos não foram afetados.</p>
      <Button className="mt-4" onClick={reset}>
        Tentar novamente
      </Button>
    </div>
  );
}
