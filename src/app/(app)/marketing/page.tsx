import { requireActor } from "@/lib/require";
import { notFound } from "next/navigation";
import { hasGlobalView } from "@/lib/authz";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { propertyUrl } from "@/server/property-preview";
import { dateOnlyKey, fmt } from "@/lib/time";
import { InlineAction } from "@/components/inline-action";
import { PageHeader, Segmented, cx } from "@/components/ui";
import { PropertyThumb } from "@/components/property-thumb";
import { leasePhotosAction, leasePostedAction } from "@/app/actions/manager";
import { CopySummary } from "./copy-summary";

export const metadata = { title: "Marketing" };

const brl = (n: number | null | undefined) => (n ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : null);

/** Locações fechadas para o marketing postar (sem dados do cliente). */
export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const actor = await requireActor({ marketing: true });
  if (actor.role !== "MARKETING" && !hasGlobalView(actor)) notFound();
  const sp = await searchParams;
  const posted = sp.aba === "postadas";
  const [posts, settings, toPost] = await Promise.all([
    db.leasePost.findMany({
      where: posted ? { postedAt: { not: null } } : { postedAt: null },
      orderBy: posted ? { postedAt: "desc" } : { createdAt: "asc" },
      take: posted ? 60 : 200,
      include: {
        agent: { select: { label: true } },
        postedBy: { select: { name: true } },
        photos: { orderBy: { position: "asc" }, select: { id: true } },
        opportunity: {
          select: {
            closedAt: true,
            closedResponsible: { select: { name: true } },
            property: { select: { code: true, title: true, category: true, neighborhood: true, city: true, rent: true, totalPrice: true, area: true, bedrooms: true, photoUrl: true } },
          },
        },
      },
    }),
    getSettings(),
    db.leasePost.count({ where: { postedAt: null } }),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Locações para postar" subtitle="Cada contrato assinado chega aqui com o diferencial e o agenciador. Depois de postar, marque como postado." />
      <div className="mb-6">
        <Segmented
          label="Situação"
          items={[
            { href: "/marketing", label: `Para postar${toPost ? ` (${toPost})` : ""}`, active: !posted },
            { href: "/marketing?aba=postadas", label: "Postadas", active: posted },
          ]}
        />
      </div>
      {posts.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line-strong px-5 py-10 text-center text-ink-3">{posted ? "Nenhuma locação postada ainda." : "Tudo postado. Quando um contrato for assinado, ele aparece aqui."}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {posts.map((p) => {
            const pr = p.opportunity.property;
            const closed = p.opportunity.closedAt ? fmt.dayKey(dateOnlyKey(p.opportunity.closedAt)) : "—";
            const facts = [pr.category, pr.bedrooms ? `${pr.bedrooms} quarto${pr.bedrooms > 1 ? "s" : ""}` : null, pr.area ? `${pr.area} m²` : null].filter(Boolean).join(" · ");
            const summary = [
              `Imóvel ${pr.code}${pr.neighborhood ? ` · ${pr.neighborhood}` : ""}${pr.city ? `, ${pr.city}` : ""}`,
              facts,
              brl(pr.totalPrice ?? pr.rent) ? `Aluguel: ${brl(pr.totalPrice ?? pr.rent)}${pr.totalPrice ? " (total com encargos)" : ""}` : "",
              `Contrato assinado em ${closed}`,
              `Consultora: ${p.opportunity.closedResponsible?.name ?? "—"} · Agenciador: ${p.agent.label}`,
              p.highlights.length ? `Diferenciais: ${p.highlights.join(", ")}` : "",
              p.highlightNote,
            ].filter(Boolean).join("\n");
            return (
              <li key={p.id} className={cx("flex flex-col overflow-hidden rounded-[26px] border bg-surface shadow-card", posted ? "border-line" : "border-accent/30")}>
                <div className="flex gap-4 p-5">
                  <PropertyThumb photoUrl={pr.photoUrl} className="size-24" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-bold tracking-[0.06em] text-accent-strong uppercase">Contrato assinado · {closed}</p>
                    <p className="num mt-0.5 text-[18px] font-bold">Imóvel {pr.code}</p>
                    <p className="text-[13px] text-ink-2">{[pr.neighborhood, pr.city].filter(Boolean).join(", ") || pr.title}</p>
                    {(facts || brl(pr.totalPrice ?? pr.rent)) && <p className="mt-0.5 text-[13px] text-ink-3">{[facts, brl(pr.totalPrice ?? pr.rent)].filter(Boolean).join(" · ")}</p>}
                  </div>
                </div>
                <div className="flex-1 space-y-2 border-t border-line px-5 py-4 text-[14px]">
                  <p>
                    <span className="text-ink-3">Agenciador:</span> <strong>{p.agent.label}</strong>
                    <span className="text-ink-3"> · Consultora:</span> {p.opportunity.closedResponsible?.name ?? "—"}
                  </p>
                  {p.highlights.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {p.highlights.map((h) => (
                        <span key={h} className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-strong">
                          {h}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap text-ink-2">{p.highlightNote}</p>
                  <PhotoStrip postId={p.id} code={pr.code} photos={p.photos.map((x) => x.id)} status={p.photosStatus} />
                  {posted && p.postedAt && (
                    <p className="text-[12px] text-ink-3">
                      Postado em {fmt.date(p.postedAt)}
                      {p.postedBy ? ` por ${p.postedBy.name}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
                  {posted ? (
                    <InlineAction action={leasePostedAction} fields={{ postId: p.id, posted: "0" }} label="Desfazer" />
                  ) : (
                    <InlineAction action={leasePostedAction} fields={{ postId: p.id, posted: "1" }} label="Marcar como postado" variant="primary" />
                  )}
                  <CopySummary text={summary} />
                  {settings.propertyUrlTemplate.includes("{codigo}") && (
                    <a href={propertyUrl(settings.propertyUrlTemplate, pr.code)} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-10 items-center rounded-full border border-line-strong px-3.5 text-[13px] font-semibold">
                      Anúncio ↗
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Fotos do anúncio guardadas na locação: baixar uma a uma ou todas (.zip) para usar no Canva. */
function PhotoStrip({ postId, code, photos, status }: { postId: string; code: string; photos: string[]; status: string | null }) {
  const SHOW = 8;
  if (photos.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2.5 text-[13px] text-ink-3">
        <span className="flex-1">{status === null ? "Guardando as fotos do anúncio… aparecem aqui em alguns minutos." : status === "NONE" ? "O anúncio não tinha fotos para guardar." : "Não consegui guardar as fotos do anúncio ainda."}</span>
        <InlineAction action={leasePhotosAction} fields={{ postId }} label="Buscar fotos agora" />
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold">
          Fotos do anúncio <span className="num font-normal text-ink-3">({photos.length})</span>
        </p>
        <a href={`/api/marketing/locacoes/${postId}/fotos`} download className="press inline-flex min-h-10 items-center rounded-full bg-primary px-3.5 text-[13px] font-semibold text-on-primary">
          Baixar todas (.zip)
        </a>
      </div>
      <ul className="grid grid-cols-4 gap-1.5">
        {photos.slice(0, SHOW).map((id, i) => (
          <li key={id}>
            <a href={`/api/marketing/fotos/${id}?baixar=1`} download title={`Baixar foto ${i + 1}`} className="press block overflow-hidden rounded-xl bg-tint">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/marketing/fotos/${id}`} alt={`Imóvel ${code}, foto ${i + 1}`} loading="lazy" className="aspect-square w-full object-cover" />
            </a>
          </li>
        ))}
      </ul>
      {photos.length > SHOW && (
        <details className="mt-1.5">
          <summary className="cursor-pointer py-1.5 text-[13px] font-semibold text-ink-2">Ver mais {photos.length - SHOW} fotos</summary>
          <ul className="grid grid-cols-4 gap-1.5">
            {photos.slice(SHOW).map((id, i) => (
              <li key={id}>
                <a href={`/api/marketing/fotos/${id}?baixar=1`} download title={`Baixar foto ${SHOW + i + 1}`} className="press block overflow-hidden rounded-xl bg-tint">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/marketing/fotos/${id}`} alt={`Imóvel ${code}, foto ${SHOW + i + 1}`} loading="lazy" className="aspect-square w-full object-cover" />
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-1.5 text-[12px] text-ink-3">Toque numa foto para baixar. Ficam guardadas aqui mesmo depois que o anúncio sai do site.</p>
    </div>
  );
}
