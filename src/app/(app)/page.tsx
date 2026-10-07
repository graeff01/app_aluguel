import { redirect } from "next/navigation";
import { requireActor } from "@/lib/require";
import { hasGlobalView } from "@/lib/authz";

export default async function Home() {
  const a = await requireActor();
  redirect(hasGlobalView(a) ? "/painel" : "/hoje");
}
