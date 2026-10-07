"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, clientIp, getActor } from "@/lib/session";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { hitRateLimit, clearRateLimit } from "@/lib/ratelimit";
import { safeEqual, sha256 } from "@/lib/crypto";
import { normalizeEmail } from "@/lib/text";
import { env } from "@/lib/env";
import { ensureReferenceData } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { str, type ActionState } from "@/lib/action";
import { log } from "@/lib/log";

const GENERIC = "E-mail ou senha incorretos.";

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(str(fd, "email"));
  const password = str(fd, "password");
  const ip = await clientIp();
  const [byIp, byEmail] = await Promise.all([hitRateLimit(`login:ip:${ip}`, 30, 900), hitRateLimit(`login:email:${sha256(email)}`, 8, 900)]);
  if (!byIp.allowed || !byEmail.allowed) {
    const wait = Math.ceil(Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds) / 60);
    return { ok: false, message: `Muitas tentativas. Aguarde cerca de ${wait} min e tente novamente.` };
  }
  const user = email ? await db.user.findUnique({ where: { email } }) : null;
  const valid = await verifyPassword(user?.passwordHash, password);
  if (!user || !valid || !user.active) {
    log.warn("auth.login_failed");
    return { ok: false, message: GENERIC };
  }
  await clearRateLimit(`login:email:${sha256(email)}`);
  await createSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login?saiu=1");
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const token = str(fd, "token");
  const password = str(fd, "password");
  if (password !== str(fd, "confirm")) return { ok: false, fieldErrors: { confirm: "As senhas não conferem." } };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, fieldErrors: { password: problem } };
  const ip = await clientIp();
  if (!(await hitRateLimit(`reset:ip:${ip}`, 20, 900)).allowed) return { ok: false, message: "Muitas tentativas. Aguarde alguns minutos." };
  const id = sha256(token);
  const ok = await db.$transaction(async (tx) => {
    const t = await tx.passwordResetToken.findUnique({ where: { id }, include: { user: true } });
    if (!t || t.usedAt || t.expiresAt < new Date() || !t.user.active) return false;
    // uso único: marca usado de forma condicional
    const used = await tx.passwordResetToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) return false;
    await tx.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(password), mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: t.userId } });
    await audit(tx, { actorId: t.userId, action: "user.password_reset", entityType: "User", entityId: t.userId });
    return true;
  });
  if (!ok) return { ok: false, message: "Link inválido, expirado ou já utilizado. Peça um novo link à gestão." };
  redirect("/login?senha=1");
}

/** Criação do primeiro administrador: só funciona sem usuários cadastrados e com SETUP_TOKEN configurado. */
export async function setupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!env.setupToken || env.setupToken.length < 16) return { ok: false, message: "Configuração inicial desabilitada (defina SETUP_TOKEN com ao menos 16 caracteres)." };
  const ip = await clientIp();
  if (!(await hitRateLimit(`setup:ip:${ip}`, 10, 900)).allowed) return { ok: false, message: "Muitas tentativas." };
  if (!safeEqual(str(fd, "setupToken"), env.setupToken)) return { ok: false, fieldErrors: { setupToken: "Código de configuração incorreto." } };
  const name = str(fd, "name").trim();
  const email = normalizeEmail(str(fd, "email"));
  const password = str(fd, "password");
  if (!name) return { ok: false, fieldErrors: { name: "Informe o nome." } };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, fieldErrors: { email: "E-mail inválido." } };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, fieldErrors: { password: problem } };
  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242)`;
    if ((await tx.user.count()) > 0) return null;
    await ensureReferenceData(tx);
    const u = await tx.user.create({ data: { name, email, role: "ADMIN", passwordHash: await hashPassword(password) } });
    await audit(tx, { actorId: u.id, action: "user.bootstrap_admin", entityType: "User", entityId: u.id });
    return u;
  });
  if (!created) return { ok: false, message: "Já existe usuário cadastrado. A configuração inicial não está mais disponível." };
  await createSession(created.id);
  redirect("/admin");
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActor();
  if (!actor) return { ok: false, message: "Sessão expirada." };
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await hitRateLimit(`pwchange:${actor.id}`, 10, 900)).allowed) return { ok: false, message: "Muitas tentativas." };
  if (!(await verifyPassword(user.passwordHash, str(fd, "current")))) return { ok: false, fieldErrors: { current: "Senha atual incorreta." } };
  const password = str(fd, "password");
  if (password !== str(fd, "confirm")) return { ok: false, fieldErrors: { confirm: "As senhas não conferem." } };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, fieldErrors: { password: problem } };
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(password), mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: actor.id } });
    await audit(tx, { actorId: actor.id, action: "user.password_changed", entityType: "User", entityId: actor.id });
  });
  await createSession(actor.id);
  return { ok: true, message: "Senha alterada. Outras sessões foram encerradas." };
}

/** Primeiro acesso com senha provisória: define a senha definitiva (obrigatório para continuar). */
export async function setInitialPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await getActor();
  if (!actor) return { ok: false, message: "Sessão expirada. Entre novamente." };
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!user.mustChangePassword) return { ok: true, message: "Senha já definida." };
  const password = str(fd, "password");
  if (password !== str(fd, "confirm")) return { ok: false, fieldErrors: { confirm: "As senhas não conferem." } };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, fieldErrors: { password: problem } };
  if (await verifyPassword(user.passwordHash, password)) return { ok: false, fieldErrors: { password: "Escolha uma senha diferente da provisória." } };
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(password), mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: actor.id } });
    await audit(tx, { actorId: actor.id, action: "user.initial_password_set", entityType: "User", entityId: actor.id });
  });
  await createSession(actor.id);
  redirect("/");
}

/** Gestão: alterna a tela única no celular. */
export async function toggleSimpleMobileAction() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  await db.user.update({ where: { id: actor.id }, data: { simpleMobile: !actor.simpleMobile } });
  redirect(actor.simpleMobile ? "/painel" : "/minhas");
}
