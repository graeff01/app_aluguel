"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { runAction, str, type ActionState } from "@/lib/action";
import { assert, canManageIntegration, canManageReasons, canManageSettings, canManageUser, isAdmin } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { normalizeEmail, normalizeText } from "@/lib/text";
import { randomToken, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { dateOnlyFromKey, isDayKey } from "@/lib/time";
import type { PatternKind, ReasonKind, Role } from "@/generated/prisma/enums";
import { authorizedClient, realCalendarApi, revokeToken } from "@/server/sync/google";
import { DETAIL_ROLES } from "@/server/sync/types";
import { requestManualSync } from "@/server/sync/runner";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES: Role[] = ["ADMIN", "MANAGER", "CONSULTANT"];

async function issueResetLink(userId: string, actorId: string) {
  const token = randomToken(32);
  await db.passwordResetToken.create({ data: { id: sha256(token), userId, expiresAt: new Date(Date.now() + 24 * 3600_000), createdById: actorId } });
  return `${env.appUrl}/redefinir-senha/${token}`;
}

function done(s: ActionState) {
  if (s.ok) revalidatePath("/", "layout");
  return s;
}

// ─────────── Usuários ───────────

export async function createUserAction(_: ActionState, fd: FormData) {
  return done(
    await runAction(async (actor) => {
      const role = str(fd, "role") as Role;
      if (!ROLES.includes(role)) throw new AppError("VALIDATION", "Papel inválido.");
      assert(canManageUser(actor, role), "Você não pode criar usuários com este papel.");
      const name = str(fd, "name").trim();
      const email = normalizeEmail(str(fd, "email"));
      if (!name) throw new AppError("VALIDATION", "Informe o nome.", { name: "Obrigatório." });
      if (!EMAIL_RE.test(email)) throw new AppError("VALIDATION", "E-mail inválido.", { email: "E-mail inválido." });
      if (await db.user.findUnique({ where: { email } })) throw new AppError("VALIDATION", "Já existe usuário com este e-mail.", { email: "Já cadastrado." });
      const aliases = str(fd, "aliases")
        .split(/[\s,;]+/)
        .map(normalizeEmail)
        .filter(Boolean);
      for (const a of aliases) if (!EMAIL_RE.test(a)) throw new AppError("VALIDATION", `E-mail da agenda inválido: ${a}`);
      const clash = await db.userEmailAlias.findFirst({ where: { email: { in: aliases } } });
      if (clash) throw new AppError("VALIDATION", `O e-mail ${clash.email} já está vinculado a outro usuário.`);
      const user = await db.$transaction(async (tx) => {
        const u = await tx.user.create({ data: { name, email, role, aliases: { create: aliases.map((e) => ({ email: e })) } } });
        await audit(tx, { actorId: actor.id, action: "user.created", entityType: "User", entityId: u.id, changes: { role, aliases } });
        return u;
      });
      const link = await issueResetLink(user.id, actor.id);
      return `Usuário criado. Envie este link para a pessoa definir a senha (vale 24 h, uso único): ${link}`;
    }),
  );
}

export async function updateUserAction(_: ActionState, fd: FormData) {
  return done(
    await runAction(async (actor) => {
      const id = str(fd, "userId");
      const target = await db.user.findUnique({ where: { id } });
      if (!target) throw new AppError("NOT_FOUND", "Usuário não encontrado.");
      assert(canManageUser(actor, target.role));
      const role = (str(fd, "role") || target.role) as Role;
      if (!ROLES.includes(role)) throw new AppError("VALIDATION", "Papel inválido.");
      assert(canManageUser(actor, role), "Você não pode atribuir este papel.");
      const active = str(fd, "active") === "1";
      const name = str(fd, "name").trim() || target.name;
      if (id === actor.id && (!active || role !== target.role)) throw new AppError("VALIDATION", "Você não pode desativar nem alterar o próprio papel.");
      if (target.role === "ADMIN" && (role !== "ADMIN" || !active)) {
        const admins = await db.user.count({ where: { role: "ADMIN", active: true, id: { not: id } } });
        if (admins === 0) throw new AppError("VALIDATION", "É preciso manter ao menos um administrador ativo.");
      }
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { name, role, active, deactivatedAt: active ? null : (target.deactivatedAt ?? new Date()) } });
        // desativar revoga acesso imediatamente; histórico é preservado
        if (!active) await tx.session.deleteMany({ where: { userId: id } });
        await audit(tx, { actorId: actor.id, action: "user.updated", entityType: "User", entityId: id, changes: { name, role, active } });
      });
      return active ? "Usuário atualizado." : "Usuário desativado. Sessões encerradas; histórico preservado.";
    }),
  );
}

export async function resetLinkAction(_: ActionState, fd: FormData) {
  return runAction(async (actor) => {
    const target = await db.user.findUnique({ where: { id: str(fd, "userId") } });
    if (!target) throw new AppError("NOT_FOUND", "Usuário não encontrado.");
    assert(canManageUser(actor, target.role));
    if (!target.active) throw new AppError("VALIDATION", "Usuário desativado.");
    const link = await issueResetLink(target.id, actor.id);
    await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "user.reset_link_issued", entityType: "User", entityId: target.id }));
    return `Link de redefinição (24 h, uso único): ${link}`;
  });
}

export async function addAliasAction(_: ActionState, fd: FormData) {
  return done(
    await runAction(async (actor) => {
      const target = await db.user.findUnique({ where: { id: str(fd, "userId") } });
      if (!target) throw new AppError("NOT_FOUND", "Usuário não encontrado.");
      assert(canManageUser(actor, target.role));
      const email = normalizeEmail(str(fd, "email"));
      if (!EMAIL_RE.test(email)) throw new AppError("VALIDATION", "E-mail inválido.", { email: "E-mail inválido." });
      const exists = await db.userEmailAlias.findUnique({ where: { email } });
      if (exists) throw new AppError("VALIDATION", exists.userId === target.id ? "E-mail já vinculado." : "Este e-mail já está vinculado a outro usuário.");
      await db.$transaction(async (tx) => {
        await tx.userEmailAlias.create({ data: { userId: target.id, email } });
        await audit(tx, { actorId: actor.id, action: "alias.added", entityType: "User", entityId: target.id, changes: { email } });
      });
      return "E-mail vinculado. Novas sincronizações usarão este mapeamento (atribuições já feitas não mudam).";
    }),
  );
}

export async function removeAliasAction(_: ActionState, fd: FormData) {
  return done(
    await runAction(async (actor) => {
      const alias = await db.userEmailAlias.findUnique({ where: { id: str(fd, "aliasId") }, include: { user: true } });
      if (!alias) throw new AppError("NOT_FOUND", "Não encontrado.");
      assert(canManageUser(actor, alias.user.role));
      await db.$transaction(async (tx) => {
        await tx.userEmailAlias.delete({ where: { id: alias.id } });
        await audit(tx, { actorId: actor.id, action: "alias.removed", entityType: "User", entityId: alias.userId, changes: { email: alias.email } });
      });
      return "E-mail removido.";
    }),
  );
}

// ─────────── Motivos ───────────

export async function reasonAction(_: ActionState, fd: FormData) {
  return done(
    await runAction(async (actor) => {
      assert(canManageReasons(actor));
      const op = str(fd, "op");
      if (op === "create") {
        const kind = str(fd, "kind") as ReasonKind;
        const label = str(fd, "label").trim();
        if (!["VISIT_NEGATIVE", "OPPORTUNITY_LOST"].includes(kind) || !label) throw new AppError("VALIDATION", "Informe o motivo.");
        const max = await db.reason.aggregate({ where: { kind }, _max: { sortOrder: true } });
        try {
          await db.reason.create({ data: { kind, label, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
        } catch {
          throw new AppError("VALIDATION", "Já existe um motivo com este nome.");
        }
        return "Motivo criado.";
      }
      const reason = await db.reason.findUnique({ where: { id: str(fd, "reasonId") }, include: { _count: { select: { visits: true, opportunities: true } } } });
      if (!reason) throw new AppError("NOT_FOUND", "Motivo não encontrado.");
      if (op === "toggle") {
        await db.reason.update({ where: { id: reason.id }, data: { active: !reason.active } });
        return reason.active ? "Motivo desativado (registros antigos preservados)." : "Motivo reativado.";
      }
      if (op === "rename") {
        const label = str(fd, "label").trim();
        if (!label) throw new AppError("VALIDATION", "Informe o nome.");
        await db.reason.update({ where: { id: reason.id }, data: { label } });
        return "Motivo renomeado.";
      }
      if (op === "delete") {
        if (reason._count.visits + reason._count.opportunities > 0) throw new AppError("VALIDATION", "Motivo já usado: desative em vez de excluir.");
        await db.reason.delete({ where: { id: reason.id } });
        return "Motivo excluído.";
      }
      if (op === "up" || op === "down") {
        const list = await db.reason.findMany({ where: { kind: reason.kind }, orderBy: { sortOrder: "asc" } });
        const i = list.findIndex((r) => r.id === reason.id);
        const j = op === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= list.length) return "Ok.";
        const ids = list.map((r) => r.id);
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await db.$transaction(ids.map((rid, k) => db.reason.update({ where: { id: rid }, data: { sortOrder: k } })));
        return "Ordem atualizada.";
      }
      throw new AppError("VALIDATION", "Operação inválida.");
    }),
  );
}

// ─────────── Padrões de eventos ───────────

export async function patternAction(_: ActionState, fd: FormData) {
  return done(
    await runAction(async (actor) => {
      assert(canManageSettings(actor));
      const op = str(fd, "op");
      if (op === "create") {
        const kind = str(fd, "kind") as PatternKind;
        const pattern = normalizeText(str(fd, "pattern"));
        if (!["VISIT_PREFIX", "EXCLUDE", "AMBIGUOUS"].includes(kind) || pattern.length < 2) throw new AppError("VALIDATION", "Informe o padrão.");
        await db.eventPattern.upsert({ where: { kind_pattern: { kind, pattern } }, update: { active: true }, create: { kind, pattern, label: str(fd, "label") || null } });
        await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "pattern.created", entityType: "EventPattern", entityId: pattern, changes: { kind } }));
        return "Padrão salvo. Vale para eventos sincronizados a partir de agora; use “sincronização completa” no diagnóstico para reavaliar a janela.";
      }
      const p = await db.eventPattern.findUnique({ where: { id: str(fd, "patternId") } });
      if (!p) throw new AppError("NOT_FOUND", "Padrão não encontrado.");
      if (op === "toggle") await db.eventPattern.update({ where: { id: p.id }, data: { active: !p.active } });
      else if (op === "delete") await db.eventPattern.delete({ where: { id: p.id } });
      await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: `pattern.${op}`, entityType: "EventPattern", entityId: p.id }));
      return "Padrão atualizado.";
    }),
  );
}

// ─────────── Regras e aplicativo ───────────

function luminance(hex: string) {
  const c = hex.replace("#", "").match(/../g)!.map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export async function settingsAction(_: ActionState, fd: FormData) {
  return done(
    await runAction(async (actor) => {
      assert(canManageSettings(actor));
      const color = str(fd, "primaryColor").toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(color)) throw new AppError("VALIDATION", "Cor inválida.", { primaryColor: "Use o formato #RRGGBB." });
      const contrast = 1.05 / (luminance(color) + 0.05);
      if (contrast < 4.5) throw new AppError("VALIDATION", "Cor muito clara: o texto branco sobre ela ficaria ilegível.", { primaryColor: `Contraste ${contrast.toFixed(1)}:1 — mínimo 4,5:1.` });
      const int = (k: string, min: number, max: number) => {
        const n = Number(str(fd, k));
        if (!Number.isInteger(n) || n < min || n > max) throw new AppError("VALIDATION", `Valor inválido em ${k}.`, { [k]: `Entre ${min} e ${max}.` });
        return n;
      };
      const start = str(fd, "resultsStartDate");
      if (!isDayKey(start)) throw new AppError("VALIDATION", "Data inválida.", { resultsStartDate: "Data inválida." });
      const data = {
        productName: str(fd, "productName").trim().slice(0, 60) || "Visitas Locação",
        primaryColor: color,
        syncIntervalMinutes: int("syncIntervalMinutes", 1, 120),
        syncPastDays: int("syncPastDays", 1, 365),
        syncFutureDays: int("syncFutureDays", 7, 365),
        manualSyncMinSeconds: int("manualSyncMinSeconds", 10, 3600),
        noteMaxLength: int("noteMaxLength", 200, 5000),
        resultsStartDate: dateOnlyFromKey(start),
        consultantCanUpdateOpp: str(fd, "consultantCanUpdateOpp") === "1",
        consultantCanCreateVisit: str(fd, "consultantCanCreateVisit") === "1",
        consultantCanCorrectData: str(fd, "consultantCanCorrectData") === "1",
      };
      await db.$transaction(async (tx) => {
        await tx.appSettings.update({ where: { id: 1 }, data });
        await audit(tx, { actorId: actor.id, action: "settings.updated", entityType: "AppSettings", entityId: "1", changes: { ...data, resultsStartDate: start } });
      });
      return "Configurações salvas.";
    }),
  );
}

// ─────────── Google ───────────

export async function selectCalendarAction(_: ActionState, fd: FormData) {
  return done(
    await runAction(async (actor) => {
      assert(canManageIntegration(actor));
      const conn = await db.googleConnection.findFirst({ where: { status: { not: "DISCONNECTED" } }, orderBy: { connectedAt: "desc" } });
      if (!conn) throw new AppError("INVALID_STATE", "Conecte uma conta Google primeiro.");
      const calendarId = str(fd, "calendarId");
      const calendars = await realCalendarApi(await authorizedClient(conn.id)).listCalendars();
      const cal = calendars.find((c) => c.id === calendarId);
      if (!cal) throw new AppError("VALIDATION", "Calendário não encontrado nesta conta.");
      if (!DETAIL_ROLES.has(cal.accessRole)) {
        throw new AppError("VALIDATION", "Esta conta só vê ocupado/livre neste calendário. Peça ao dono da agenda para compartilhar com permissão “Ver todos os detalhes do evento” (ou superior) e tente de novo.");
      }
      await db.$transaction(async (tx) => {
        await tx.googleConnection.update({ where: { id: conn.id }, data: { calendarId: cal.id, calendarSummary: cal.summary, calendarAccessRole: cal.accessRole, statusDetail: null } });
        // novo calendário → sincronização completa (estado anterior desse calendário é reaproveitado se existir)
        await tx.syncState.upsert({ where: { calendarId: cal.id }, update: { syncToken: null }, create: { calendarId: cal.id } });
        await audit(tx, { actorId: actor.id, action: "google.calendar_selected", entityType: "GoogleConnection", entityId: conn.id, changes: { calendarId: cal.id, accessRole: cal.accessRole } });
      });
      await requestManualSync(actor.id);
      return `Calendário “${cal.summary}” selecionado. A primeira sincronização foi solicitada.`;
    }),
  );
}

export async function disconnectGoogleAction(_: ActionState, _fd: FormData) {
  return done(
    await runAction(async (actor) => {
      assert(canManageIntegration(actor));
      const conns = await db.googleConnection.findMany({ where: { status: { not: "DISCONNECTED" } } });
      for (const c of conns) {
        await revokeToken(c.refreshTokenEnc);
        await db.googleConnection.update({ where: { id: c.id }, data: { status: "DISCONNECTED", refreshTokenEnc: null, accessTokenEnc: null, accessTokenExpiresAt: null } });
      }
      await db.$transaction((tx) => audit(tx, { actorId: actor.id, action: "google.disconnected", entityType: "GoogleConnection", entityId: conns[0]?.id ?? "-" }));
      return "Conta Google desconectada. Registros já feitos continuam disponíveis.";
    }),
  );
}

export async function fullSyncAction(_: ActionState, _fd: FormData) {
  return runAction(async (actor) => {
    assert(isAdmin(actor));
    const conn = await db.googleConnection.findFirst({ where: { status: "CONNECTED", calendarId: { not: null } } });
    if (!conn?.calendarId) throw new AppError("INVALID_STATE", "Integração não configurada.");
    await db.syncState.updateMany({ where: { calendarId: conn.calendarId }, data: { syncToken: null } });
    const r = await requestManualSync(actor.id);
    return r.created ? "Sincronização completa solicitada." : "Já há uma sincronização pendente; a próxima será completa.";
  });
}
