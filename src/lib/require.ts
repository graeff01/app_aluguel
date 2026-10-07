import "server-only";
import { redirect } from "next/navigation";
import { notFound as nextNotFound } from "next/navigation";
import { getActor, type Actor } from "./session";
import { hasGlobalView, isAdmin } from "./authz";
import { AppError } from "./errors";

export async function requireActor(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  return a;
}
export async function requireManager(): Promise<Actor> {
  const a = await requireActor();
  if (!hasGlobalView(a)) nextNotFound();
  return a;
}
export async function requireAdmin(): Promise<Actor> {
  const a = await requireActor();
  if (!isAdmin(a)) nextNotFound();
  return a;
}
/** Converte NOT_FOUND/FORBIDDEN do domínio em 404 da página. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) nextNotFound();
    throw e;
  }
}
