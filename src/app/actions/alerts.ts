"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/session";
import { markAllAlertsRead, openAlert } from "@/server/alerts";

/** Abre o aviso: marca como lido e leva para a tela do assunto. */
export async function openAlertAction(fd: FormData) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const url = await openAlert(actor, String(fd.get("id") ?? "")).catch(() => "/avisos");
  revalidatePath("/", "layout");
  redirect(url);
}

export async function readAllAlertsAction() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  await markAllAlertsRead(actor);
  revalidatePath("/", "layout");
}
