import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";
import { env } from "./env";
import type { Role } from "@/generated/prisma/enums";

const SESSION_DAYS = 30;
const REFRESH_AFTER_MS = 24 * 3600_000;

export function sessionCookieName() {
  // Prefixo __Host- exige Secure, Path=/ e sem Domain (proteção contra subdomínios).
  return env.secureCookies ? "__Host-vl_session" : "vl_session";
}

export type Actor = { id: string; name: string; email: string; role: Role; mustChangePassword: boolean; simpleMobile: boolean };

export async function createSession(userId: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({ data: { id: sha256(token), userId, expiresAt } });
  const jar = await cookies();
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token) await db.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(sessionCookieName());
}

/** Usuário autenticado e ativo da requisição atual (ou null). */
export const getActor = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token) return null;
  const id = sha256(token);
  const session = await db.session.findUnique({ where: { id }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now() || !session.user.active) {
    await db.session.deleteMany({ where: { id } });
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    await db.session.update({
      where: { id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) },
    });
  }
  const u = session.user;
  return { id: u.id, name: u.name, email: u.email, role: u.role, mustChangePassword: u.mustChangePassword, simpleMobile: u.simpleMobile };
});

/** IP do cliente (atrás do proxy do Railway) — usado só para limitação de tentativas. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

/** Celular pelo user-agent (só para escolher o layout; nunca para autorização). */
export async function isMobileRequest(): Promise<boolean> {
  const h = await headers();
  return h.get("sec-ch-ua-mobile") === "?1" || /Mobi|Android|iPhone|iPad|iPod/i.test(h.get("user-agent") ?? "");
}
