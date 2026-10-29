import Link from "next/link";
import { ClientFileLink } from "@/components/client-file-link";
import { requireActor, orNotFound } from "@/lib/require";
import { clientSearchDetail, PROPERTY_TYPES, SEARCH_CLOSE_LABEL } from "@/server/client-search";
import { dateOnlyKey, fmt } from "@/lib/time";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";
import { cx } from "@/components/ui";
import { ContactButtons } from "@/components/contact-buttons";
import { PropertyThumb } from "@/components/property-thumb";
import { Suspense } from "react";
import { ProfileForm, ContactForm, CloseForm } from "./forms";
import { SearchSuggestions } from "./similar";
import { MarketReading } from "@/components/market-reading";

export const metadata = { title: "Cliente em busca" };
const dOnly = (d: Date) => dateOnlyKey(d).split("-").reverse().join("/");

export default async function SearchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ novo?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  const s = await orNotFound(clientSearchDetail(actor, id));
  const active = s.status === "ACTIVE";
  const name = s.client.anonymizedAt ? "Cliente (dados removidos)" : s.client.name;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/em-busca" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Clientes em busca
      </Link>
      {sp.novo && <p role="status" className="mb-5 rounded-2xl bg-good-soft px-4 py-3 text-sm font-semibold text-good">✓ Cliente marcado como em busca. Complete o perfil abaixo (opcional) para lembrar o que ele procura.</p>}
      <p className={cx("mb-1 text-xs font-semibold tracking-[0.14em] uppercase", active ? (s.due ? "text-accent-strong" : s.stale ? "text-bad" : "text-accent-strong") : "text-ink-3")}>
        {active ? (s.due ? "Ligar hoje" : s.stale ? `Sem contato há ${s.silentDays} dias` : (s.days === 0 ? "Em busca desde hoje" : `Em busca há ${s.days} ${s.days === 1 ? "dia" : "dias"}`)) : SEARCH_CLOSE_LABEL[s.status as keyof typeof SEARCH_CLOSE_LABEL]}
      </p>
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.035em]">{name}</h1>
      <ClientFileLink clientId={s.clientId} className="mt-2" />
      <p className="mt-1 text-[14px] text-ink-3">
        Consultora {s.consultant.name} · desde {fmt.shortDate(s.startedAt).replace(".", "")}
        {s.lastContactAt ? ` · último contato ${fmt.shortDate(s.lastContactAt).replace(".", "")}` : ""}
        {active && s.followUpOn ? ` · próximo contato ${dOnly(s.followUpOn)}` : ""}
      </p>

      {active && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {s.phone && <ContactButtons phone={s.phone} name={s.client.name} />}
          {s.lastVisitId && (
            <Link href={`/visitas/${s.lastVisitId}/reagendar`} className="press inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-semibold text-white shadow-float">
              Marcar visita em outro imóvel →
            </Link>
          )}
        </div>
      )}

      {active && (
        <section className="mt-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="t-contato">
          <h2 id="t-contato" className="text-[16px] font-bold">
            Registrar contato
          </h2>
          <p className="mb-3 text-[13px] text-ink-3">Falou com o cliente? Anote o que combinaram e quando falar de novo.</p>
          <ContactForm id={s.id} />
        </section>
      )}

      <section className="mt-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="t-perfil">
        <h2 id="t-perfil" className="mb-3 text-[16px] font-bold">
          O que procura
        </h2>
        {active ? (
          <ProfileForm
            key={s.lastContactAt?.toISOString() ?? "sem-contato"}
            id={s.id}
            types={[...PROPERTY_TYPES]}
            initial={{
              maxBudget: s.maxBudgetCents ? (s.maxBudgetCents / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "",
              areas: s.areas.join(", "),
              propertyType: s.propertyType ?? "",
              bedrooms: s.bedrooms != null ? String(s.bedrooms) : "",
              mustNot: s.mustNot ?? "",
              note: s.note ?? "",
            }}
          />
        ) : (
          <p className="text-[14px] whitespace-pre-wrap text-ink-2">{s.note ?? "—"}</p>
        )}
      </section>

      {active && <MarketReading profile={s} className="mt-6" />}

      {active && !s.client.anonymizedAt && (
        <section className="mt-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="t-site">
          <h2 id="t-site" className="text-[17px] font-bold">
            Opções no site para este cliente
          </h2>
          <p className="mb-3 text-[13px] text-ink-3">Imóveis disponíveis hoje no site da Auxiliadora com o perfil acima. Escolha até 3 e envie pelo WhatsApp com a mensagem pronta.</p>
          <Suspense fallback={<p className="text-[14px] text-ink-3">Buscando no site…</p>}>
            <SearchSuggestions
              actorId={actor.id}
              s={{ id: s.id, name, phone: s.phone, maxBudgetCents: s.maxBudgetCents, areas: s.areas, propertyType: s.propertyType, bedrooms: s.bedrooms, sentCodes: s.sentCodes, siteNewCodes: s.siteNewCodes, rejectedCodes: s.rejectedCodes, siteRules: s.siteRules, seenCodes: s.seen.map((v) => v.propertyCode).filter((c): c is string => !!c) }}
            />
          </Suspense>
        </section>
      )}

      <section className="mt-6 rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-6" aria-labelledby="t-vistos">
        <h2 id="t-vistos" className="mb-3 text-[16px] font-bold">
          Imóveis que já viu {s.seen.length > 0 && <span className="font-medium text-ink-3">· {s.seen.length}</span>}
        </h2>
        {s.seen.length === 0 ? (
          <p className="text-[14px] text-ink-3">Nenhuma visita registrada.</p>
        ) : (
          <ul className="divide-y divide-line">
            {s.seen.map((v) => (
              <li key={v.id}>
                <Link href={`/visitas/${v.id}`} className="flex items-center gap-3 py-3">
                  <PropertyThumb photoUrl={v.property?.photoUrl} className="size-12" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">
                      Imóvel <span className="num">{v.propertyCode ?? "—"}</span>
                      {v.property?.neighborhood ? <span className="font-normal text-ink-3"> · {v.property.neighborhood}</span> : null}
                    </span>
                    <span className="text-[13px] text-ink-3">
                      {fmt.shortDate(v.scheduledStart).replace(".", "")} · {v.status === "DONE" ? (v.evaluation ? EVALUATION_LABEL[v.evaluation] : STATUS_LABEL[v.status]) : "Agendada"}
                      {v.negativeReason ? ` — ${v.negativeReason.label}` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {active ? (
        <section className="mt-6 mb-10 rounded-[26px] border border-line bg-surface-2 p-5 sm:p-6" aria-labelledby="t-fim">
          <h2 id="t-fim" className="text-[16px] font-bold">
            Encerrar a busca
          </h2>
          <p className="mb-3 text-[13px] text-ink-3">Se ele assinar contrato com a gente, a busca termina sozinha como “Alugou conosco”.</p>
          <CloseForm id={s.id} />
        </section>
      ) : (
        <p className="mt-6 mb-10 text-[14px] text-ink-3">
          Encerrada em {s.closedAt ? fmt.shortDate(s.closedAt).replace(".", "") : "—"}
          {s.closeNote ? ` — “${s.closeNote}”` : ""}
        </p>
      )}
    </div>
  );
}
