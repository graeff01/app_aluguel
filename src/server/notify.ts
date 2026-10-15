/** Notificação no celular (sem dados do cliente). Assinatura vencida é removida. */
import { db } from "@/lib/db";
import { pushConfig, sendPush } from "@/lib/push";

export async function notifyUser(userId: string, payload: { title: string; body: string; url: string; tag: string }) {
  if (!pushConfig()) return;
  const subs = await db.pushSubscription.findMany({ where: { userId, user: { active: true } } });
  for (const s of subs) {
    const r = await sendPush(s, payload).catch(() => "error" as const);
    if (r === "gone") await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}
