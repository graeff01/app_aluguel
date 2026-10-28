import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { canUseRadar } from "@/server/radar";
import { PROPERTY_TYPES } from "@/server/client-search";
import { PageHeader } from "@/components/ui";
import { RadarForm } from "./form";

export const metadata = { title: "Novo no radar" };

export default async function NewRadarPage() {
  const actor = await requireActor({ preService: true });
  if (!canUseRadar(actor)) notFound();
  return (
    <>
      <Link href="/radar" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Radar de clientes
      </Link>
      <PageHeader title="Novo no radar" subtitle="O cliente procura algo que não temos na base agora. Registre o pedido que vai para a captação; o app lembra você de cobrar." />
      <RadarForm types={[...PROPERTY_TYPES]} />
      <p className="mt-4 max-w-2xl text-[12px] text-ink-3">Proteção de dados: o telefone fica criptografado e é apagado automaticamente depois que o pedido é encerrado, no prazo de retenção.</p>
    </>
  );
}
