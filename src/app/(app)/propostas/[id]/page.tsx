import Link from "next/link";
import { ClientFileLink } from "@/components/client-file-link";
import { requireActor, orNotFound } from "@/lib/require";
import { brl, proposalDetail } from "@/server/proposals";
import { PROPOSAL_STATUS_CLS, PROPOSAL_STATUS_LABEL } from "@/lib/labels";
import { fmt } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { PageHeader, cx } from "@/components/ui";
import { ContactButtons } from "@/components/contact-buttons";
import { PropertyThumb } from "@/components/property-preview";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { deleteProposalAction } from "@/app/actions/proposals";
import { ProposalStatusForm } from "./status-form";

export const metadata = { title: "Proposta" };

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ enviada?: string }> }) {
  const actor = await requireActor({ preService: true });
  const { id } = await params;
  const sp = await searchParams;
  const p = await orNotFound(proposalDetail(actor, id));
  const closed = p.status === "ACCEPTED" || p.status === "REJECTED";
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/propostas" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Propostas
      </Link>
      {sp.enviada && <p role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">✓ Enviada para {p.consultant.name}. Ela foi avisada no app.</p>}
      <PageHeader
        eyebrow="Proposta"
        title={p.clientName}
        subtitle={`Enviada por ${p.createdBy.name} para ${p.consultant.name}${p.ownClient ? " (cliente já era dela, fora do rodízio)" : ""} · ${fmt.dateTime(p.createdAt)}`}
        action={<span className={cx("inline-flex rounded-full px-3 py-1 text-[13px] font-bold", PROPOSAL_STATUS_CLS[p.status])}>{PROPOSAL_STATUS_LABEL[p.status]}</span>}
      />
      <ClientFileLink clientId={p.clientId} className="-mt-2 mb-5" />

      <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="flex gap-4">
          <PropertyThumb photoUrl={p.property?.photoUrl} className="size-[84px]" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">Valor proposto</p>
            <p className="num text-[30px] leading-tight font-bold tracking-[-0.02em]">
              {brl(p.rentCents)}
              <span className="text-[15px] font-medium text-ink-3"> /mês</span>
            </p>
            <p className="mt-1 text-[14px] text-ink-2">
              Imóvel <span className="num font-semibold text-ink">{p.propertyCode}</span>
              {p.property?.neighborhood ? ` · ${p.property.neighborhood}` : ""}
            </p>
            {p.status === "COUNTER" && p.counterCents ? (
              <p className="mt-2 inline-flex rounded-full bg-warn-soft px-3 py-1 text-[13px] font-bold text-warn">Contraproposta do proprietário: {brl(p.counterCents)}</p>
            ) : null}
          </div>
        </div>
        <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">Cliente</dt>
            <dd className="text-[16px] font-semibold">{p.clientName}</dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">Telefone</dt>
            <dd className="text-[16px] font-semibold">{p.purgedAt ? <span className="text-ink-3">apagado (prazo da LGPD)</span> : p.phone ? formatPhone(p.phone) : "—"}</dd>
          </div>
        </dl>
        {!p.purgedAt && p.phone && <ContactButtons phone={p.phone} name={p.clientName.split(" ")[0] || "cliente"} className="mt-4" />}
        {p.note && <p className="mt-4 rounded-2xl bg-tint px-4 py-3 text-sm text-ink-2">“{p.note}”</p>}
      </section>

      {p.status !== "NEW" && (
        <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-2 text-[15px] font-bold">Último andamento</h2>
          <p className="text-[15px]">
            <strong>{PROPOSAL_STATUS_LABEL[p.status]}</strong>
            {p.statusBy ? ` · ${p.statusBy.name}` : ""}
            {p.statusAt ? ` · ${fmt.dateTime(p.statusAt)}` : ""}
          </p>
          {p.resultNote && <p className="mt-2 text-sm text-ink-2">“{p.resultNote}”</p>}
        </section>
      )}

      {p.canUpdate && !p.purgedAt && (
        <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
          <ProposalStatusForm id={p.id} current={p.status} />
          <p className="mt-3 text-[12px] text-ink-3">{closed ? "Precisa corrigir? Registre o andamento certo: o pré-atendimento é avisado." : "A negociação com o proprietário é feita fora do sistema. Aqui você registra cada passo e o pré-atendimento é avisado na hora."}</p>
        </section>
      )}

      {p.canDelete && (
        <ActionForm action={deleteProposalAction} confirm="Excluir esta proposta? Use só se foi enviada por engano." className="mb-6">
          <input type="hidden" name="id" value={p.id} />
          <SubmitButton variant="danger">Excluir proposta</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
