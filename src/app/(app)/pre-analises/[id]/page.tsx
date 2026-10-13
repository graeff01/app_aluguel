import Link from "next/link";
import { requireActor, orNotFound } from "@/lib/require";
import { formatCpf, preAnalysisDetail } from "@/server/pre-analysis";
import { INCOME_BAND_LABEL, PRE_STATUS_LABEL } from "@/lib/labels";
import { fmt } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { Alert, PageHeader, cx } from "@/components/ui";
import { ContactButtons } from "@/components/contact-buttons";
import { InlineAction } from "@/components/inline-action";
import { deletePreAnalysisAction } from "@/app/actions/pre-analysis";
import { ResultForm } from "./result-form";

export const metadata = { title: "Pré-análise" };

const STATUS_CLS: Record<string, string> = {
  AWAITING: "bg-accent-soft text-accent-strong",
  PENDING: "bg-[#e7effc] text-[#2357b3] dark:bg-[#1f2c44] dark:text-[#93b8ff]",
  APPROVED: "bg-good-soft text-good",
  REJECTED: "bg-bad-soft text-bad",
};
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function PreAnalysisPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ enviada?: string }> }) {
  const actor = await requireActor({ preService: true });
  const { id } = await params;
  const sp = await searchParams;
  const p = await orNotFound(preAnalysisDetail(actor, id));
  const birth = p.birthDate ? p.birthDate.split("-").reverse().join("/") : null;
  const fields: [string, React.ReactNode][] = p.purgedAt
    ? []
    : [
        ["CPF", p.cpf ? <span className="num">{formatCpf(p.cpf)}</span> : "—"],
        ["Data de nascimento", birth ? `${birth} (${p.age} anos)` : "—"],
        ["E-mail", p.email ? <a href={`mailto:${p.email}`} className="break-all underline underline-offset-4">{p.email}</a> : "—"],
        ["Telefone", p.phone ? formatPhone(p.phone) : "—"],
        ["Salário", p.salaryCents ? <span className="num">{brl(p.salaryCents)}</span> : "—"],
      ];
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/pre-analises" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Pré-análises
      </Link>
      {sp.enviada && <p role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">✓ Enviada para {p.consultant.name}. Ela foi avisada no app.</p>}
      <PageHeader
        eyebrow="Pré-análise"
        title={p.fullName}
        subtitle={`Enviada por ${p.createdBy.name} para ${p.consultant.name} · ${fmt.dateTime(p.createdAt)}`}
        action={<span className={cx("inline-flex rounded-full px-3 py-1 text-[13px] font-bold", STATUS_CLS[p.status])}>{PRE_STATUS_LABEL[p.status]}</span>}
      />

      {p.previous.length > 0 && (
        <Alert tone="warn" title="Este CPF já teve pré-análise">
          {p.previous.map((x) => (
            <span key={x.id} className="block">
              <Link href={`/pre-analises/${x.id}`} className="underline underline-offset-4">
                {fmt.date(x.createdAt)} — {PRE_STATUS_LABEL[x.status]} ({x.consultant.name})
              </Link>
            </span>
          ))}
        </Alert>
      )}

      <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
        <h2 className="mb-3 text-[15px] font-bold">Dados do titular</h2>
        {p.purgedAt ? (
          <p className="text-sm text-ink-3">Dados pessoais apagados em {fmt.date(p.purgedAt)} (prazo de {p.retentionDays} dias da LGPD). Ficam só nome, faixa de renda e resultado.</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {fields.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{k}</dt>
                <dd className="text-[16px] font-semibold">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">Faixa de renda</dt>
              <dd className="text-[16px] font-semibold">{INCOME_BAND_LABEL[p.incomeBand]}</dd>
            </div>
            {p.propertyCode && (
              <div>
                <dt className="text-[12px] font-semibold tracking-wide text-ink-3 uppercase">Imóvel de interesse</dt>
                <dd className="num text-[16px] font-semibold">{p.propertyCode}</dd>
              </div>
            )}
          </dl>
        )}
        {!p.purgedAt && p.phone && <ContactButtons phone={p.phone} name={p.fullName.split(" ")[0]} className="mt-4" />}
        {p.note && <p className="mt-4 rounded-2xl bg-tint px-4 py-3 text-sm text-ink-2">“{p.note}”</p>}
      </section>

      {(p.status !== "AWAITING" || p.resultNote) && (
        <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-2 text-[15px] font-bold">Resultado</h2>
          <p className="text-[15px]">
            <strong>{PRE_STATUS_LABEL[p.status]}</strong>
            {p.resultBy ? ` · ${p.resultBy.name}` : ""}
            {p.resultAt ? ` · ${fmt.dateTime(p.resultAt)}` : ""}
          </p>
          {p.resultNote && <p className="mt-2 text-sm text-ink-2">“{p.resultNote}”</p>}
        </section>
      )}

      {p.canResolve && !p.purgedAt && (
        <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
          <ResultForm id={p.id} current={p.status} />
          <p className="mt-3 text-[12px] text-ink-3">A análise é feita fora do sistema. Aqui você só registra o resultado — o pré-atendimento é avisado na hora.</p>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pb-8">
        {p.purgeAt && <p className="text-[12px] text-ink-3">LGPD: os dados pessoais serão apagados automaticamente em {fmt.date(p.purgeAt)}.</p>}
        {p.canDelete && <InlineAction action={deletePreAnalysisAction} fields={{ id: p.id }} label="Excluir pré-análise" variant="danger" confirm="Excluir esta pré-análise? Use só se foi enviada por engano." />}
      </div>
    </div>
  );
}
