import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { pushConfig } from "@/lib/push";

const subSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "endpoint inválido"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Registra a inscrição de notificação deste aparelho para o usuário logado. */
export async function POST(req: NextRequest) {
  return apiHandler(req, async (actor) => {
    if (!pushConfig()) throw new AppError("INVALID_STATE", "Lembretes ainda não configurados no servidor.");
    const parsed = subSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION", "Inscrição inválida.");
    const { endpoint, keys } = parsed.data;
    // um aparelho pertence a quem está logado nele agora
    await db.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: actor.id, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null },
      create: { userId: actor.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null },
    });
    return { ok: true };
  });
}

/** Remove a inscrição deste aparelho (desativar lembretes ou sair). */
export async function DELETE(req: NextRequest) {
  return apiHandler(req, async (actor) => {
    const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
    if (body?.endpoint) await db.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: actor.id } });
    return { ok: true };
  });
}
