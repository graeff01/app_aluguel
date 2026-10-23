import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canCreatePreAnalysis } from "@/lib/authz";
import { assignmentQueue } from "@/server/pre-analysis";
import { PageHeader } from "@/components/ui";
import { ProposalForm } from "./form";

export const metadata = { title: "Nova proposta" };

export default async function NewProposalPage() {
  const actor = await requireActor({ preService: true });
  if (!canCreatePreAnalysis(actor)) notFound();
  const consultants = await assignmentQueue();
  return (
    <>
      <Link href="/propostas" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Propostas
      </Link>
      <PageHeader title="Nova proposta" subtitle="O valor que o cliente propôs para o aluguel. Vai para a consultora da vez, que leva ao proprietário." />
      {consultants.length === 0 ? <p className="text-ink-2">Nenhuma consultora ativa para encaminhar.</p> : <ProposalForm consultants={consultants} />}
      <p className="mt-4 max-w-2xl text-[12px] text-ink-3">Proteção de dados: o telefone fica criptografado, é visto só pelo pré-atendimento, pela gestão e pela consultora escolhida, e é apagado automaticamente após o prazo de retenção.</p>
    </>
  );
}
