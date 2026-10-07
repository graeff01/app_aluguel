import "server-only";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { getActor, type Actor } from "./session";
import { errorCode, log } from "./log";

export type ActionState = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; at?: number };
export const initialState: ActionState = { ok: false };

/** Executa uma server action autenticada com tratamento de erros uniforme. */
export async function runAction(fn: (actor: Actor) => Promise<string | void>): Promise<ActionState> {
  const actor = await getActor();
  if (!actor) return { ok: false, message: "Sua sessão expirou. Entre novamente.", at: Date.now() };
  if (actor.mustChangePassword) return { ok: false, message: "Defina sua senha pessoal antes de continuar.", at: Date.now() };
  try {
    const message = await fn(actor);
    return { ok: true, message: message || "Salvo.", at: Date.now() };
  } catch (e) {
    return toState(e);
  }
}

export function toState(e: unknown): ActionState {
  if (e instanceof AppError) {
    const fe = e.details && typeof e.details === "object" ? (e.details as Record<string, string>) : undefined;
    return { ok: false, message: e.message, fieldErrors: fe, at: Date.now() };
  }
  if (e instanceof ZodError) {
    return { ok: false, message: "Revise os campos.", fieldErrors: Object.fromEntries(e.issues.map((i) => [i.path.join("."), i.message])), at: Date.now() };
  }
  // redirect()/notFound() do Next precisam propagar
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
  log.error("action.failed", { code: errorCode(e) });
  return { ok: false, message: "Não foi possível concluir agora. Tente novamente.", at: Date.now() };
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
