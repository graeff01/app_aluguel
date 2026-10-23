import Link from "next/link";
import { requireActor } from "@/lib/require";
import { canCreatePreAnalysis } from "@/lib/authz";
import { brl, listProposals } from "@/server/proposals";
import { PROPOSAL_STATUS_CLS, PROPOSAL_STATUS_LABEL } from "@/lib/labels";
import { fmt } from "@/lib/time";
import { relativeTime } from "@/lib/visit-tone";
import { Empty, LinkButton, PageHeader, Segmented, cx } from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "Propostas" };

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ aba?: string; q?: string; excluida?: string }> }) {
  const actor = await requireActor({ preService: true });
  const sp = await searchParams;
  const tab = sp.aba === "encerradas" ? "encerradas" : "abertas";
  const now = new Date();
  const rows = await listProposals(actor, { tab, q: sp.q });
  return (
    <>
      <PageHeader
        title="Propostas"
        subtitle={actor.role === "CONSULTANT" ? "Propostas de valor encaminhadas para você. Leve ao proprietário e registre o andamento." : "Valor proposto pelo cliente para o aluguel, encaminhado à consultora da vez."}
        action={
          canCreatePreAnalysis(actor) ? (
            <LinkButton href="/propostas/nova">
              <Icon name="plus" className="size-4" /> Nova proposta
            </LinkButton>
          ) : undefined
        }
      />
      {sp.excluida && <p role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">Proposta excluída.</p>}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Situação"
          items={[
            { href: "/propostas", label: "Em aberto", active: tab === "abertas" },
            { href: "/propostas?aba=encerradas", label: "Encerradas", active: tab === "encerradas" },
          ]}
        />
        <form role="search" className="w-full sm:w-72">
          {tab === "encerradas" && <input type="hidden" name="aba" value="encerradas" />}
          <label htmlFor="q" className="sr-only">
            Buscar por nome ou código do imóvel
          </label>
          <input id="q" name="q" type="search" defaultValue={sp.q} placeholder="Buscar por nome ou imóvel" className="block min-h-11 w-full rounded-full border border-line-strong bg-surface px-5 text-[15px] shadow-card focus:border-ink focus:outline-none" />
        </form>
      </div>
      {rows.length === 0 ? (
        <Empty title={tab === "abertas" ? "Nenhuma proposta em aberto" : "Nenhuma encerrada ainda"} icon="✓">
          {tab === "abertas" && canCreatePreAnalysis(actor) ? "Use “Nova proposta” para enviar o valor que o cliente propôs à consultora da vez." : undefined}
        </Empty>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((r, i) => (
            <li key={r.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <Link href={`/propostas/${r.id}`} className="press block h-full rounded-3xl border border-line bg-surface p-4 shadow-card hover:shadow-float">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[16px] font-bold">{r.clientName}</p>
                  <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold", PROPOSAL_STATUS_CLS[r.status])}>{PROPOSAL_STATUS_LABEL[r.status]}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-2">
                  <span className="num font-semibold text-ink">{brl(r.rentCents)}</span> · imóvel <span className="num">{r.propertyCode}</span>
                  {r.status === "COUNTER" && r.counterCents ? ` · contraproposta ${brl(r.counterCents)}` : ""} · {actor.role === "CONSULTANT" ? `enviada por ${r.createdBy.name.split(" ")[0]}` : `para ${r.consultant.name}`}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Enviada {relativeTime(r.createdAt, now)} ({fmt.dateTime(r.createdAt)})
                  {r.statusAt ? ` · atualizada ${relativeTime(r.statusAt, now)}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
