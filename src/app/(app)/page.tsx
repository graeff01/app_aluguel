import { redirect } from "next/navigation";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";
import { isMobileRequest } from "@/lib/session";

export default async function Home() {
  const a = await requireActor();
  if (!hasGlobalView(a) || (a.simpleMobile && (await isMobileRequest()))) redirect("/minhas");
  redirect("/painel");
}
