import type { AuthzActor } from "@/lib/authz";
import { similarOnSite } from "@/server/radar";
import { SiteSuggestionsBlock } from "@/components/site-suggestions-block";

type Radar = { id: string; clientName: string; phone: string | null; maxBudgetCents: number | null; areas: string[]; propertyType: string | null; bedrooms: number | null; foundCodes: string[]; siteNewCodes: string[] };

/** Opções parecidas no site da imobiliária (carrega depois do resto da página). */
export async function SimilarOnSite({ actor, radar }: { actor: AuthzActor; radar: Radar }) {
  const r = await similarOnSite(actor, radar);
  return <SiteSuggestionsBlock result={r} kind="radar" id={radar.id} actorId={actor.id} phone={radar.phone} clientName={radar.clientName} newCodes={radar.siteNewCodes} empty="Nenhum imóvel no site com esse perfil agora: é caso para a captação." />;
}
