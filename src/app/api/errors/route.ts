import type { NextRequest } from "next/server";
import { checkOrigin } from "@/lib/api";
import { getActor, clientIp } from "@/lib/session";
import { hitRateLimit } from "@/lib/ratelimit";
import { recordError } from "@/lib/error-tracking";

/** Recebe erros do navegador (somente do próprio app, com limite por IP). */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return new Response(null, { status: 403 });
  const ip = await clientIp();
  if (!(await hitRateLimit(`errors:${ip}`, 30, 600)).allowed) return new Response(null, { status: 429 });
  const body = (await req.json().catch(() => null)) as { message?: string; path?: string; stack?: string } | null;
  if (!body?.message) return new Response(null, { status: 204 });
  const actor = await getActor();
  await recordError({ source: "client", message: String(body.message), path: body.path ?? null, userId: actor?.id ?? null, stackTop: body.stack ? String(body.stack).split("\n")[1] : null });
  return new Response(null, { status: 204 });
}
