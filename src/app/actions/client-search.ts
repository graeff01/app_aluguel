"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, str, type ActionState } from "@/lib/action";
import { closeClientSearch, logSearchContact, startClientSearch, updateSearchProfile } from "@/server/client-search";

const profileOf = (fd: FormData) => ({
  maxBudget: str(fd, "maxBudget"),
  areas: str(fd, "areas"),
  propertyType: str(fd, "propertyType"),
  bedrooms: str(fd, "bedrooms"),
  mustNot: str(fd, "mustNot"),
  note: fd.has("note") ? str(fd, "note") : undefined,
});

/** Negócio que caiu → "Cliente segue em busca" (abre a busca e vai para ela). */
export async function startSearchFromOpportunityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const s = await runAction(async (a) => {
    id = (await startClientSearch(a, { opportunityId: str(fd, "opportunityId") })).id;
  });
  if (s.ok && id) {
    revalidatePath("/", "layout");
    redirect(`/em-busca/${id}?novo=1`);
  }
  return s;
}

export async function updateSearchProfileAction(_: ActionState, fd: FormData) {
  const s = await runAction((a) => updateSearchProfile(a, str(fd, "id"), profileOf(fd)).then(() => "Perfil da busca salvo."));
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

export async function logSearchContactAction(_: ActionState, fd: FormData) {
  const raw = str(fd, "followUpDays");
  const s = await runAction((a) => logSearchContact(a, str(fd, "id"), { note: str(fd, "contactNote"), followUpDays: raw ? Number(raw) : null }).then(() => "Contato registrado."));
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

export async function closeSearchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await runAction((a) => closeClientSearch(a, str(fd, "id"), str(fd, "outcome"), str(fd, "closeNote")).then(() => "Busca encerrada."));
  if (s.ok) {
    revalidatePath("/", "layout");
    redirect("/em-busca");
  }
  return s;
}
