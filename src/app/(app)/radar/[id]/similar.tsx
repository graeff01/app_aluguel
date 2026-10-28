/* eslint-disable @next/next/no-img-element */
import type { AuthzActor } from "@/lib/authz";
import { similarOnSite } from "@/server/radar";
import { brl } from "@/server/proposals";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { addSuggestedAction } from "@/app/actions/radar";

type Radar = { id: string; maxBudgetCents: number | null; areas: string[]; propertyType: string | null; bedrooms: number | null; foundCodes: string[] };

/** Opções parecidas no site da imobiliária (carrega depois do resto da página). */
export async function SimilarOnSite({ actor, radar }: { actor: AuthzActor; radar: Radar }) {
  const r = await similarOnSite(actor, radar);
  if (!r.searched) return <p className="text-[14px] text-ink-3">Preencha tipo, quartos, valor ou bairros no pedido para o app sugerir opções do site.</p>;
  if (r.error) return <p className="text-[14px] text-ink-3">O site não respondeu agora. Tente de novo em instantes.</p>;
  return (
    <>
      {r.items.length === 0 ? (
        <p className="text-[14px] text-ink-2">Nenhum imóvel no site com esse perfil agora: é caso para a captação.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {r.items.map((it) => (
            <li key={it.code} className="overflow-hidden rounded-2xl border border-line bg-surface">
              {it.photoUrl && (
                <div className="relative aspect-[16/9] bg-tint">
                  <img src={it.photoUrl} alt={`Imóvel ${it.code}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />
                </div>
              )}
              <div className="p-3">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="num text-[13px] font-bold">Imóvel {it.code}</span>
                  {(it.totalCents ?? it.rentCents) && <span className="num text-[15px] font-bold">{brl((it.totalCents ?? it.rentCents)!)}</span>}
                </p>
                <p className="text-[13px] text-ink-2">
                  {[it.category, it.neighborhood, it.bedrooms ? `${it.bedrooms} quarto${it.bedrooms > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ")}
                  {it.totalCents && it.rentCents && it.totalCents !== it.rentCents ? <span className="text-ink-3"> · aluguel {brl(it.rentCents)}</span> : null}
                </p>
                {it.reasons.length > 0 && <p className="mt-1 text-[12px] font-semibold text-good">✓ {it.reasons.join(" · ")}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-9 items-center rounded-full border border-line-strong px-3 text-[13px] font-semibold">
                    Ver anúncio ↗
                  </a>
                  <ActionForm action={addSuggestedAction}>
                    <input type="hidden" name="id" value={radar.id} />
                    <input type="hidden" name="code" value={it.code} />
                    <SubmitButton variant="secondary" className="min-h-9 px-3 text-[13px]">
                      Indiquei ao cliente
                    </SubmitButton>
                  </ActionForm>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {r.moreUrl && (
        <a href={r.moreUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[13px] font-semibold underline underline-offset-4">
          Ver mais no site com esse perfil ↗
        </a>
      )}
    </>
  );
}
