import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { propertyUrl } from "@/server/property-preview";
import { describeRules, type LearnedRules, type SimilarResult } from "@/server/site-search";
import { ResetRules } from "./reset-rules";
import { SiteSuggestions } from "./site-suggestions";

/** Resultado da busca no site → cartões com escolha e envio pelo WhatsApp (radar ou cliente em busca). */
export async function SiteSuggestionsBlock({ result, kind, id, actorId, phone, clientName, newCodes, rules, empty }: { result: SimilarResult; kind: "radar" | "search"; id: string; actorId: string; phone: string | null; clientName: string; newCodes: string[]; rules?: LearnedRules | null; empty: string }) {
  if (!result.searched) return <p className="text-[14px] text-ink-3">Preencha tipo, quartos, valor ou bairros para o app sugerir opções do site.</p>;
  if (result.error) return <p className="text-[14px] text-ink-3">O site não respondeu agora. Tente de novo em instantes.</p>;
  const [settings, me] = await Promise.all([getSettings(), db.user.findUnique({ where: { id: actorId }, select: { name: true } })]);
  // link com a etiqueta da imobiliária (a mesma do resto do app); os novos no site primeiro
  const items = result.items
    .map((it) => ({ ...it, url: settings.propertyUrlTemplate.includes("{codigo}") ? propertyUrl(settings.propertyUrlTemplate, it.code) : it.url, isNew: newCodes.includes(it.code) }))
    .sort((a, b) => Number(b.isNew) - Number(a.isNew));
  const learned = describeRules(rules);
  return (
    <>
      {learned.length > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-tint px-3 py-2 text-[13px] text-ink-2">
          <span>
            <strong>Ajustado pelo que ficou fora do perfil:</strong> {learned.join(" · ")}
          </span>
          <ResetRules kind={kind} id={id} />
        </p>
      )}
      {items.length === 0 ? <p className="text-[14px] text-ink-2">{empty}</p> : <SiteSuggestions kind={kind} id={id} items={items} phone={phone} clientName={clientName} senderName={me?.name ?? ""} />}
      {result.moreUrl && (
        <a href={result.moreUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[13px] font-semibold underline underline-offset-4">
          Ver mais no site com esse perfil ↗
        </a>
      )}
    </>
  );
}
