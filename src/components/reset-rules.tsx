"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetRulesAction } from "@/app/actions/radar";

/** Desfaz os ajustes aprendidos com as opções "fora do perfil". */
export function ResetRules({ kind, id }: { kind: "radar" | "search"; id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await resetRulesAction(kind, id);
          if (r.ok) router.refresh();
        })
      }
      className="font-semibold underline underline-offset-2 disabled:opacity-50"
    >
      Desfazer ajustes
    </button>
  );
}
