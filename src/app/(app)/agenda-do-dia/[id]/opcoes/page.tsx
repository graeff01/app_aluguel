/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/require";
import { hasGlobalView, isPreService } from "@/lib/authz";
import { db } from "@/lib/db";
import { dayKey, fmt } from "@/lib/time";
import { alternativesForVisit } from "@/server/site-watch";
import { brl } from "@/server/proposals";
import { PageHeader } from "@/components/ui";
import { SwapToThis } from "./swap";

export const metadata = { title: "Opções parecidas" };

export default async function VisitAlternativesPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor({ preService: true });
  if (!isPreService(actor) && !hasGlobalView(actor)) notFound();
  const { id } = await params;
  const { visit: v, profile, result } = await alternativesForVisit(actor, id).catch(() => notFound());
  const reasons = await db.reason.findMany({ where: { kind: "VISIT_CANCEL", active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } });
  const reasonId = reasons.find((r) => /alugad|indispon/i.test(r.label))?.id ?? reasons[0]?.id ?? "";
  const p = v.property;
  const open = v.status === "SCHEDULED";
  const price = p?.totalPrice ?? p?.rent ?? null;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/agenda-do-dia?dia=${dayKey(v.scheduledStart)}`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Visitas do dia
      </Link>
      <PageHeader eyebrow="Trocar imóvel" title={`Opções parecidas com o ${v.propertyCode ?? "imóvel"}`} subtitle={`${v.clientName ?? "Cliente"} · ${fmt.shortDate(v.scheduledStart)} às ${fmt.time(v.scheduledStart)}${v.consultant ? ` · ${v.consultant.name}` : ""}`} />
      <section className="mb-5 flex gap-4 rounded-[26px] border border-line bg-surface p-4 shadow-card">
        {p?.photoUrl && <img src={p.photoUrl} alt="" referrerPolicy="no-referrer" className="size-20 shrink-0 rounded-2xl object-cover" />}
        <div className="min-w-0 text-[14px]">
          <p className="font-semibold">Imóvel da visita: {v.propertyCode}</p>
          <p className="text-ink-2">{[p?.category, p?.neighborhood, p?.bedrooms ? `${p.bedrooms} quartos` : null, price ? brl(price * 100) : null].filter(Boolean).join(" · ") || "Sem dados do anúncio"}</p>
          {v.listingGoneAt && <p className="mt-1 font-semibold text-warn">⚠ O anúncio saiu do site em {fmt.shortDate(v.listingGoneAt)} (pode ter sido alugado).</p>}
        </div>
      </section>
      {!open ? (
        <p className="rounded-2xl bg-tint px-4 py-3 text-sm font-semibold text-ink-2">{v.swappedTo ? `Esta visita já foi trocada para o imóvel ${v.swappedTo}.` : "Esta visita não está mais agendada."}</p>
      ) : !result.searched ? (
        <p className="text-[14px] text-ink-3">Sem dados do anúncio deste imóvel para comparar. Use “Trocar imóvel” na agenda com o código novo.</p>
      ) : result.error ? (
        <p className="text-[14px] text-ink-3">O site não respondeu agora. Tente de novo em instantes.</p>
      ) : result.items.length === 0 ? (
        <p className="text-[14px] text-ink-2">Nenhuma opção parecida no site agora ({[profile.propertyType, profile.areas[0], profile.bedrooms ? `${profile.bedrooms}+ quartos` : null].filter(Boolean).join(", ")}).</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {result.items.map((it) => (
            <li key={it.code} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {it.photoUrl && (
                <div className="relative aspect-[16/9] bg-tint">
                  <img src={it.photoUrl} alt={`Imóvel ${it.code}`} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />
                </div>
              )}
              <div className="p-3">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="num text-[13px] font-bold">Imóvel {it.code}</span>
                  {(it.totalCents ?? it.rentCents) ? <span className="num text-[15px] font-bold">{brl((it.totalCents ?? it.rentCents)!)}</span> : null}
                </p>
                <p className="text-[13px] text-ink-2">{[it.category, it.neighborhood, it.bedrooms ? `${it.bedrooms} quarto${it.bedrooms > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ")}</p>
                {it.reasons.length > 0 && <p className="mt-1 text-[12px] font-semibold text-good">✓ {it.reasons.join(" · ")}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-9 items-center rounded-full border border-line-strong px-3 text-[13px] font-semibold">
                    Ver anúncio ↗
                  </a>
                  {v.propertyCode && <SwapToThis visitId={v.id} seenCode={v.propertyCode} newCode={it.code} reasonId={reasonId} />}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && result.moreUrl && (
        <a href={result.moreUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-[13px] font-semibold underline underline-offset-4">
          Ver mais no site com esse perfil ↗
        </a>
      )}
    </div>
  );
}
