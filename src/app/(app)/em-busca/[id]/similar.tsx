import { findSimilarOnSite } from "@/server/site-search";
import { SiteSuggestionsBlock } from "@/components/site-suggestions-block";

type Search = { id: string; name: string; phone: string | null; maxBudgetCents: number | null; areas: string[]; propertyType: string | null; bedrooms: number | null; sentCodes: string[]; siteNewCodes: string[]; seenCodes: string[] };

/** Opções do site com o perfil da busca (sem os imóveis que o cliente já visitou ou já recebeu). */
export async function SearchSuggestions({ actorId, s }: { actorId: string; s: Search }) {
  const r = await findSimilarOnSite({ ...s, exclude: [...s.sentCodes, ...s.seenCodes] });
  return <SiteSuggestionsBlock result={r} kind="search" id={s.id} actorId={actorId} phone={s.phone} clientName={s.name} newCodes={s.siteNewCodes} empty="Nenhum imóvel novo no site com esse perfil agora. O app avisa você quando aparecer." />;
}
