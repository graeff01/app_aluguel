import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { AppError } from "./errors";
import { checkOrigin } from "./api";
import { hitRateLimit } from "./ratelimit";
import { errorCode, log } from "./log";
import { SESSION_COOKIE } from "@/server/doc-requests";

/** Rotas do link público do cliente: mesma origem, limite por IP e erros com mensagem amigável. */
export async function clientApi(req: NextRequest, bucket: string, limit: number, fn: (cookie: string | undefined) => Promise<unknown>) {
  if (!checkOrigin(req)) return NextResponse.json({ error: "FORBIDDEN", message: "Origem inválida." }, { status: 403 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const rl = await hitRateLimit(`doc:${bucket}:${ip}`, limit, 3600);
  if (!rl.allowed) return NextResponse.json({ error: "RATE_LIMITED", message: "Muitas tentativas. Aguarde um pouco e tente de novo." }, { status: 429 });
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const data = await fn(cookie);
    return NextResponse.json(data ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code, message: e.message, details: e.details }, { status: e.status, headers: { "Cache-Control": "no-store" } });
    log.error("doclink.failed", { code: errorCode(e), bucket });
    return NextResponse.json({ error: "INTERNAL", message: "Não foi possível concluir agora. Tente de novo em instantes." }, { status: 500 });
  }
}
