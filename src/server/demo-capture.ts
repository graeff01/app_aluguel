/**
 * Sugestões deixadas na demonstração pública da captação (encerrada: agora a captação usa o app com login).
 * As que chegaram continuam guardadas para a gestão ler.
 */
import { db } from "@/lib/db";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";

export async function listDemoFeedback(actor: AuthzActor) {
  assert(hasGlobalView(actor));
  return db.demoFeedback.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
}
