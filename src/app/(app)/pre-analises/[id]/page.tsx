import Link from "next/link";
import { db } from "@/lib/db";
import { requireActor, orNotFound } from "@/lib/require";
import { formatCpf, preAnalysisDetail } from "@/server/pre-analysis";
import { INCOME_BAND_LABEL, PRE_STATUS_LABEL } from "@/lib/labels";
import { fmt } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { Alert, PageHeader, cx } from "@/components/ui";
import { ContactButtons } from "@/components/contact-buttons";
import { InlineAction } from "@/components/inline-action";
import { addPreAnalysisFilesAction, deletePreAnalysisAction, deletePreAnalysisFileAction } from "@/app/actions/pre-analysis";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { FileAttach } from "@/components/file-attach";
import { hasGlobalView } from "@/lib/authz";
import { ResultForm } from "./result-form";
import { DocRequestsPanel } from "@/components/doc-requests/panel";
import { SchedulePreVisitForm } from "./schedule-form";
import { STATUS_LABEL } from "@/lib/labels";
import { addDays, dayKey } from "@/lib/time";

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
  const missingOptions = await db.reason.findMany({ where: { kind: "PRE_MISSING", active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } });
  const birth = p.birthDate ? p.birthDate.split("-").reverse().join("/") : null;
  const fields: [string, React.ReactNode][] = p.purgedAt
    ? []
    : [
        ["CPF", p.cpf ? <span className="num">{formatCpf(p.cpf)}</span> : "—"],
        ["Data de nascimento", birth ? `${birth} (${p.age} anos)` : "—"],
        ["E-mail", p.email ? <a href={`mailto:${p.email}`} className="break-all underline underline-offset-4">{p.email}</a> : "—"],
        ["Telefone", p.phone ? formatPhone(p.phone) : "—"],
        ["Salário", p.salaryCents ? <span className="num">{brl(p.salaryCents)}</span> : "—"],
        ["Garantia", p.guarantee?.label ?? "—"],
      ];
  const sizeLabel = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/pre-analises" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Pré-análises
      </Link>
      {sp.enviada && <p role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">✓ Enviada para {p.consultant.name}. Ela foi avisada no app.</p>}
      <PageHeader
        eyebrow="Pré-análise"
        title={p.fullName || "Titular sem nome"}
        subtitle={`Enviada por ${p.createdBy.name} para ${p.consultant.name}${p.ownClient ? " (cliente já era dela, fora do rodízio)" : ""} · ${fmt.dateTime(p.createdAt)}`}
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
        {!p.purgedAt && p.phone && <ContactButtons phone={p.phone} name={p.fullName.split(" ")[0] || "cliente"} className="mt-4" />}
        {p.note && <p className="mt-4 rounded-2xl bg-tint px-4 py-3 text-sm text-ink-2">“{p.note}”</p>}
      </section>

      <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="t-docs">
        <h2 id="t-docs" className="mb-3 text-[15px] font-bold">
          Documentos do cliente {p.files.length > 0 && <span className="font-medium text-ink-3">· {p.files.length}</span>}
        </h2>
        {p.purgedAt ? (
          <p className="text-sm text-ink-3">Documentos apagados junto com os dados pessoais (prazo da LGPD).</p>
        ) : (
          <>
            {p.files.length === 0 ? (
              <p className="mb-4 text-sm text-ink-3">Nenhum documento anexado.</p>
            ) : (
              <ul className="mb-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {p.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <a href={`/api/pre-analises/${p.id}/arquivos/${f.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold underline-offset-4 hover:underline">
                        {f.mime === "application/pdf" ? "📄" : "🖼️"} {f.name}
                      </span>
                      <span className="text-[12px] text-ink-3">
                        {sizeLabel(f.size)} · {f.uploadedBy.name.split(" ")[0]} · {fmt.dateTime(f.createdAt)}
                      </span>
                    </a>
                    <span className="flex gap-1">
                      <a href={`/api/pre-analises/${p.id}/arquivos/${f.id}?baixar=1`} className="press inline-flex min-h-10 items-center rounded-full border border-line-strong px-3 text-[13px] font-semibold">
                        Baixar
                      </a>
                      {(f.uploadedById === actor.id || hasGlobalView(actor)) && <InlineAction action={deletePreAnalysisFileAction} fields={{ fileId: f.id }} label="Remover" variant="danger" confirm={`Remover ${f.name}?`} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={addPreAnalysisFilesAction} resetOnSuccess>
              <input type="hidden" name="id" value={p.id} />
              <FileAttach hint="Faltou algum documento? Anexe aqui: quem enviou a pré-análise e a consultora são avisadas." />
              <SubmitButton variant="secondary">Enviar documentos</SubmitButton>
            </ActionForm>
          </>
        )}
      </section>

      {!p.purgedAt && <DocRequestsPanel actor={actor} target={{ preAnalysisId: p.id }} guaranteeLabel={p.guarantee?.label} hasPhone={!!p.phone} />}

      {p.missingItems.length > 0 && p.status !== "APPROVED" && p.status !== "REJECTED" && (
        <section className={cx("mb-6 rounded-[26px] border-2 p-5 shadow-card sm:p-6", p.status === "PENDING" ? "border-[#2f6fde]/40 bg-[#eef4ff] dark:bg-[#1a2436]" : "border-line bg-surface")} aria-labelledby="t-falta">
          <h2 id="t-falta" className="mb-2 text-[15px] font-bold">{p.status === "PENDING" ? "O que falta para a análise" : "Faltava (já enviado, aguardando nova análise)"}</h2>
          <ul className="space-y-1.5 text-[15px]">
            {p.missingItems.map((m) => (
              <li key={m} className="flex items-center gap-2">
                <span aria-hidden className={cx("grid size-5 place-items-center rounded-full text-[11px] font-bold", p.status === "PENDING" ? "bg-[#2f6fde] text-white" : "bg-good text-bg")}>{p.status === "PENDING" ? "!" : "✓"}</span>
                {m}
              </li>
            ))}
          </ul>
          {p.status === "PENDING" && <p className="mt-3 text-[13px] text-ink-2">Anexe em “Documentos do cliente” abaixo: a pré-análise volta sozinha para a consultora analisar.</p>}
        </section>
      )}
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

      {p.visits.length > 0 && (
        <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-2 text-[15px] font-bold">Visitas desta pré-análise</h2>
          <ul className="space-y-1.5 text-sm">
            {p.visits.map((v) => (
              <li key={v.id}>
                <Link href={p.canResolve ? `/visitas/${v.id}/registrar` : "/agenda-do-dia"} className="underline underline-offset-4">
                  {fmt.dateTime(v.scheduledStart)} · imóvel {v.propertyCode} · {STATUS_LABEL[v.status]}
                </Link>
                {!v.sourceEventId && !v.googleCreatedAt && v.status === "SCHEDULED" && <span className="ml-2 text-[12px] font-semibold text-warn">falta pôr na agenda</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.status === "APPROVED" && p.canResolve && !p.purgedAt && (
        <section className="mb-6 rounded-[26px] border-2 border-good/30 bg-good-soft/40 p-5 shadow-card sm:p-6">
          <h2 className="text-[17px] font-bold">{p.visits.length ? "Agendar outra visita" : "Agendar a visita"}</h2>
          <p className="mb-4 text-[13px] text-ink-2">Cliente, telefone e imóvel já preenchidos. Depois, um toque coloca na agenda Google (conta central e cópias).</p>
          <SchedulePreVisitForm id={p.id} propertyCode={p.propertyCode ?? ""} defaultDate={addDays(dayKey(new Date()), 1)} />
        </section>
      )}

      {p.canResolve && !p.purgedAt && (
        <section className="mb-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6">
          <ResultForm id={p.id} current={p.status} missingOptions={missingOptions} currentMissing={p.missingItems} />
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
