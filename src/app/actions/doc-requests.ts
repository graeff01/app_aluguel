"use server";
import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/session";
import { runAction, str, toState, type ActionState } from "@/lib/action";
import { cancelDocRequest, createDocRequest, renewDocRequest } from "@/server/doc-requests";
import { docShareMessage, whatsappUrl } from "@/lib/doc-share";

export type DocCreateState = ActionState & { url?: string; whatsapp?: string | null };

/** Gera (ou complementa) o pedido de documentos e devolve o link pronto para o WhatsApp. */
export async function createDocRequestAction(_: DocCreateState, fd: FormData): Promise<DocCreateState> {
  const actor = await getActor();
  if (!actor) return { ok: false, message: "Sessão expirada. Entre novamente." };
  try {
    const r = await createDocRequest(actor, {
      preAnalysisId: str(fd, "preAnalysisId") || undefined,
      visitId: str(fd, "visitId") || undefined,
      itemKeys: fd.getAll("item").map(String),
      custom: str(fd, "custom").split(/\n|;/),
      message: str(fd, "message"),
      phone: str(fd, "phone"),
    });
    revalidatePath("/", "layout");
    const text = docShareMessage({ clientName: r.clientName, sender: actor.name, url: r.url, verify: null });
    return {
      ok: true,
      at: Date.now(),
      message: r.reused ? (r.added ? `Incluídos ${r.added} documento${r.added === 1 ? "" : "s"} no mesmo link do cliente.` : "O cliente já tem um link com estes documentos.") : "Link criado.",
      url: r.url,
      whatsapp: whatsappUrl(r.phone, text),
    };
  } catch (e) {
    return toState(e);
  }
}

export async function renewDocRequestAction(_: ActionState, fd: FormData) {
  const s = await runAction((a) => renewDocRequest(a, str(fd, "id")).then(() => "Prazo renovado por mais 7 dias."));
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

export async function cancelDocRequestAction(_: ActionState, fd: FormData) {
  const s = await runAction((a) => cancelDocRequest(a, str(fd, "id")).then(() => "Link cancelado: o cliente não consegue mais abrir."));
  if (s.ok) revalidatePath("/", "layout");
  return s;
}
