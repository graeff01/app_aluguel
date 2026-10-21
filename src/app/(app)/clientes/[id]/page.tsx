import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor, orNotFound } from "@/lib/require";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { dateOnlyKey, fmt } from "@/lib/time";
import { PRE_STATUS_LABEL } from "@/lib/labels";
import { Badge, cx, KeyValue, Panel, Section } from "@/components/ui";
import { ContactButtons } from "@/components/contact-buttons";
import { PropertyThumb } from "@/components/property-thumb";
import { clientFile, resolveClientId, type TimelineItem, type TimelineKind, type Tone } from "@/server/client-file";
import { MergeForm } from "./merge-form";
import { AnonymizeForm } from "./anonymize-form";

export const metadata = { title: "Ficha do cliente" };

const KIND_LABEL: Record<TimelineKind, string> = { pre: "Pré-análise", docs: "Documentos", visit: "Visita", deal: "Negócio", search: "Busca" };
const DOT: Record<Tone, string> = { good: "bg-good", bad: "bg-bad", accent: "bg-accent", info: "bg-[#2f6fde]", neutral: "bg-ink-3" };
const CARD: Record<Tone, string> = {
  good: "border-good/30 bg-good-soft",
  bad: "border-bad/30 bg-bad-soft",
  accent: "border-accent/30 bg-accent-soft",
  info: "border-[#2f6fde]/25 bg-[#eef4ff] dark:bg-[#1a2436]",
  neutral: "border-line bg-surface",
};
const dOnly = (d: Date) => dateOnlyKey(d).split("-").reverse().slice(0, 2).join("/");

function NowCard({ tone, label, title, sub, href }: { tone: Tone; label: string; title: string; sub?: string; href?: string }) {
  const body = (
    <>
      <span className="block text-[11px] font-bold tracking-[0.1em] text-ink-2 uppercase">{label}</span>
      <span className="mt-0.5 block text-[16px] leading-snug font-bold">{title}</span>
      {sub && <span className="mt-0.5 block text-[13px] text-ink-2">{sub}</span>}
    </>
  );
  const cls = cx("block rounded-[20px] border px-4 py-3.5", CARD[tone]);
  return href ? (
    <Link href={href} className={cx(cls, "press")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Entry({ e, first }: { e: TimelineItem; first: boolean }) {
  const inner = (
    <div className="min-w-0 flex-1 pb-6">
      <p className="text-[12px] font-semibold text-ink-3">
        {fmt.shortDate(e.at).replace(".", "")}
        {e.kind === "visit" ? ` · ${fmt.time(e.at)}` : ""} · {KIND_LABEL[e.kind]}
      </p>
      <div className="mt-0.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={cx("text-[15px] leading-snug font-bold", e.href && "underline-offset-4 group-hover:underline")}>{e.title}</p>
          {e.detail && <p className="mt-0.5 text-[13px] text-ink-2">{e.detail}</p>}
          {e.note && <p className="mt-1.5 line-clamp-3 rounded-xl bg-tint px-3 py-2 text-[13px] whitespace-pre-wrap text-ink-2">“{e.note}”</p>}
        </div>
        {e.kind === "visit" && <PropertyThumb photoUrl={e.photoUrl} className="size-12 shrink-0" />}
      </div>
    </div>
  );
  return (
    <li className="relative flex gap-3.5">
      <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
        <span className="absolute top-0 bottom-0 w-px bg-line" />
        <span className={cx("relative mt-1.5 size-3 rounded-full ring-4 ring-bg", DOT[e.tone], first && "size-3.5")} />
      </span>
      {e.href ? (
        <Link href={e.href} className="group block min-w-0 flex-1">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor({ preService: true });
  const { id } = await params;
  const mainId = await orNotFound(resolveClientId(id));
  if (mainId !== id) redirect(`/clientes/${mainId}`);
  const f = await orNotFound(clientFile(actor, id));
  const c = f.client;
  const global = f.mode === "all";
  const anon = !!c.anonymizedAt;
  const name = anon ? "Cliente (dados removidos)" : c.name;
  const n = f.now;
  const samePhone =
    global && c.phones.some((p) => p.normalized)
      ? await db.client.findMany({ where: { id: { not: c.id }, mergedIntoId: null, phones: { some: { normalized: { in: c.phones.map((p) => p.normalized).filter((x): x is string => !!x) } } } }, select: { id: true, name: true } })
      : [];
  const back = global ? ["/clientes", "Clientes"] : f.mode === "pre" ? ["/pre-analises", "Pré-análises"] : ["/minhas", "Minhas visitas"];

  const now: React.ReactNode[] = [];
  if (n.won) now.push(<NowCard key="won" tone="good" label="Alugou conosco" title={`Imóvel ${n.won.code}`} sub={n.won.label} href={global || f.mode === "own" ? `/oportunidades/${n.won.id}` : undefined} />);
  if (n.openDeal) now.push(<NowCard key="deal" tone="accent" label="Negócio em andamento" title={`Imóvel ${n.openDeal.code}`} sub={`${n.openDeal.label}${global && n.openDeal.responsible ? ` · ${n.openDeal.responsible.split(" ")[0]}` : ""}`} href={f.mode === "pre" ? undefined : `/oportunidades/${n.openDeal.id}`} />);
  if (n.awaiting) now.push(<NowCard key="await" tone="accent" label="Visita sem resultado" title={`Imóvel ${n.awaiting.code ?? "—"}`} sub={`${fmt.shortDate(n.awaiting.at).replace(".", "")} · registre o que aconteceu`} href={f.mode === "pre" ? undefined : `/visitas/${n.awaiting.id}/registrar`} />);
  if (n.upcoming) now.push(<NowCard key="next" tone="info" label="Próxima visita" title={`${fmt.shortDate(n.upcoming.at).replace(".", "")} às ${fmt.time(n.upcoming.at)}`} sub={`Imóvel ${n.upcoming.code ?? "—"}`} href={f.mode === "pre" ? undefined : `/visitas/${n.upcoming.id}`} />);
  if (n.activeSearch) now.push(<NowCard key="search" tone="accent" label="Em busca de outro imóvel" title="Segue procurando" sub={n.activeSearch.followUpOn ? `Próximo contato ${dOnly(n.activeSearch.followUpOn)}` : "Sem data de contato"} href={f.mode === "pre" ? undefined : `/em-busca/${n.activeSearch.id}`} />);
  if (n.openDocs) now.push(<NowCard key="docs" tone={n.openDocs.done === n.openDocs.total ? "good" : "neutral"} label="Documentos pelo link" title={`${n.openDocs.done} de ${n.openDocs.total} enviados`} sub="Aguardando o cliente concluir" href={n.openDocs.href} />);
  if (n.lastPre && !n.won && !n.openDeal) now.push(<NowCard key="pre" tone={n.lastPre.status === "APPROVED" ? "good" : n.lastPre.status === "REJECTED" ? "bad" : "neutral"} label="Pré-análise" title={PRE_STATUS_LABEL[n.lastPre.status]} sub={`Enviada em ${fmt.shortDate(n.lastPre.at).replace(".", "")}`} href={`/pre-analises/${n.lastPre.id}`} />);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={back[0]} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← {back[1]}
      </Link>
      <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase">Ficha do cliente</p>
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.035em] break-words">{name}</h1>
      <p className="mt-1 text-[14px] text-ink-2">
        {[
          f.phone && !anon ? formatPhone(f.phone) : null,
          f.stats.first ? `desde ${fmt.shortDate(f.stats.first).replace(".", "")}` : null,
          f.stats.visits ? `${f.stats.visits} ${f.stats.visits === 1 ? "visita" : "visitas"} em ${f.stats.properties} ${f.stats.properties === 1 ? "imóvel" : "imóveis"}` : "nenhuma visita realizada",
        ]
          .filter(Boolean)
          .join(" · ")}
        {global && (
          <span className="ml-2 align-middle">
            <Badge tone={c.identityStatus === "CONFIRMED" ? "good" : "warn"}>{c.identityStatus === "CONFIRMED" ? "Identidade confirmada" : "Identificação pendente"}</Badge>
          </span>
        )}
      </p>
      {!anon && f.phone && <ContactButtons phone={f.phone} name={c.name} className="mt-4" />}
      {f.othersCount > 0 && <p className="mt-4 rounded-2xl bg-tint px-4 py-3 text-[13px] text-ink-2">Este cliente também teve atendimento com outra consultora. Aqui aparece só o que é seu.</p>}

      <section aria-labelledby="t-agora" className="mt-7">
        <h2 id="t-agora" className="mb-3 text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">
          Agora
        </h2>
        {now.length ? <div className="grid gap-2.5 sm:grid-cols-2">{now}</div> : <p className="rounded-[20px] border border-dashed border-line-strong px-4 py-4 text-[14px] text-ink-3">Nada em andamento com este cliente.</p>}
        {(f.actions.scheduleFrom || f.actions.docsFrom) && !anon && (
          <div className="mt-3 flex flex-wrap gap-2">
            {f.actions.scheduleFrom && (
              <Link href={`/visitas/${f.actions.scheduleFrom}/reagendar`} className="press inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-[14px] font-semibold text-on-primary">
                Marcar visita
              </Link>
            )}
            {f.actions.docsFrom && (
              <Link href={`/visitas/${f.actions.docsFrom}/documentos`} className="press inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-5 text-[14px] font-semibold">
                Pedir documentos
              </Link>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="t-hist" className="mt-9">
        <h2 id="t-hist" className="mb-4 text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">
          Histórico
        </h2>
        {f.timeline.length ? (
          <ol>
            {f.timeline.map((e, i) => (
              <Entry key={e.id} e={e} first={i === 0} />
            ))}
          </ol>
        ) : (
          <p className="text-[14px] text-ink-3">Nada registrado ainda.</p>
        )}
      </section>

      {global && (
        <div className="mt-6 border-t border-line pt-6">
          <Panel className="mb-6">
            <KeyValue items={[["Telefones", c.phones.map((p) => `${formatPhone(p.normalized, p.raw)}${p.valid ? "" : " (não validado)"}`).join(" · ") || "—"]]} />
          </Panel>
          {c.mergedIntoId && (
            <p className="mb-4 text-warn">
              Este cadastro foi unido a outro.{" "}
              <Link className="underline" href={`/clientes/${c.mergedIntoId}`}>
                Abrir cadastro principal
              </Link>
            </p>
          )}
          <Section title="Unir cadastros">
            <MergeForm sourceId={c.id} suggestions={samePhone} />
          </Section>
          <Section title="Privacidade (LGPD)">
            <p className="mb-3 text-sm text-ink-2">
              Pedido de acesso do titular:{" "}
              <a href={`/api/clientes/${c.id}/exportar`} className="font-semibold text-ink underline underline-offset-4">
                baixar todos os dados deste cliente
              </a>{" "}
              (visitas, observações, andamentos, pré-análises e busca). O download fica registrado na auditoria.
            </p>
            {anon ? <p className="rounded-3xl border border-line bg-surface-2 p-5 text-sm text-ink-3">Dados pessoais removidos em {c.anonymizedAt!.toLocaleDateString("pt-BR")}. Indicadores preservados.</p> : <AnonymizeForm clientId={c.id} />}
          </Section>
        </div>
      )}
    </div>
  );
}
