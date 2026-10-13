import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canCreatePreAnalysis } from "@/lib/authz";
import { assignmentQueue } from "@/server/pre-analysis";
import { PageHeader } from "@/components/ui";
import { PreAnalysisForm } from "./form";

export const metadata = { title: "Nova pré-análise" };

export default async function NewPreAnalysisPage() {
  const actor = await requireActor({ preService: true });
  if (!canCreatePreAnalysis(actor)) notFound();
  const consultants = await assignmentQueue();
  return (
    <>
      <Link href="/pre-analises" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Pré-análises
      </Link>
      <PageHeader title="Nova pré-análise" subtitle="Antes de agendar a visita. A consultora recebe tudo no app, faz a análise e responde aqui." />
      {consultants.length === 0 ? <p className="text-ink-2">Nenhuma consultora ativa para encaminhar.</p> : <PreAnalysisForm consultants={consultants} />}
      <p className="mt-4 max-w-2xl text-[12px] text-ink-3">
        Proteção de dados: CPF, nascimento, e-mail, telefone e salário ficam criptografados, são vistos só pelo pré-atendimento, pela gestão e pela consultora escolhida, e são apagados automaticamente após o prazo de retenção.
      </p>
    </>
  );
}
