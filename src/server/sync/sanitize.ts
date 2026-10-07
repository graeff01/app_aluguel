import sanitizeHtml from "sanitize-html";
import { stripConferenceBlock } from "@/lib/parser";

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/**
 * Converte a descrição HTML do Google em texto puro: remove todas as tags, o bloco do Meet e limita o tamanho.
 * O texto é exibido como texto (React escapa), nunca como HTML.
 */
export function htmlToText(html: string | null | undefined, max = 4000): string | null {
  if (!html) return null;
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} }).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
  const text = stripConferenceBlock(stripped).replace(/\n{3,}/g, "\n\n").trim();
  return text ? text.slice(0, max) : null;
}
