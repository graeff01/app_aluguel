import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "./errors";
import { env } from "./env";
import { getActor, type Actor } from "./session";
import { errorCode, log } from "./log";

/** Proteção CSRF para rotas de API: Origin deve ser o próprio app e o cabeçalho customizado deve estar presente. */
export function checkOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (req.headers.get("x-requested-with") !== "visitas") return false;
  if (!origin) return false;
  const allowed = new Set([env.appUrl]);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? (env.secureCookies ? "https" : "http");
  if (host) allowed.add(`${proto}://${host}`);
  return allowed.has(origin);
}

export async function apiHandler(req: NextRequest, fn: (actor: Actor) => Promise<unknown>, opts: { mutation?: boolean } = { mutation: true }) {
  if (opts.mutation && !checkOrigin(req)) return NextResponse.json({ error: "FORBIDDEN", message: "Origem inválida." }, { status: 403 });
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "UNAUTHENTICATED", message: "Sessão expirada. Entre novamente." }, { status: 401 });
  if (actor.mustChangePassword) return NextResponse.json({ error: "FORBIDDEN", message: "Defina sua senha pessoal antes de continuar." }, { status: 403 });
  try {
    const data = await fn(actor);
    return NextResponse.json(data ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code, message: e.message, details: e.details }, { status: e.status, headers: { "Cache-Control": "no-store" } });
    log.error("api.failed", { code: errorCode(e), path: req.nextUrl.pathname.replace(/[a-z0-9]{20,}/gi, ":id") });
    return NextResponse.json({ error: "INTERNAL", message: "Erro inesperado. Tente novamente." }, { status: 500 });
  }
}
