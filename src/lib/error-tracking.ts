/**
 * Registro de erros próprio (sem serviço externo). Sem dados pessoais:
 * e-mails, telefones, números longos e ids são mascarados antes de gravar.
 */
import { createHash } from "node:crypto";
import { db } from "./db";
import { sendPush } from "./push";

export function scrubMessage(input: string, max = 300) {
  return input
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{20,}\b/gi, "[id]")
    .replace(/\(?\+?\d[\d\s().-]{7,}\d/g, "[número]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function scrubPath(path: string | null | undefined) {
  if (!path) return null;
  return path
    .split("?")[0]
    .replace(/\/[a-z0-9]{20,}/gi, "/:id")
    .slice(0, 200);
}

export async function recordError(e: { source: "client" | "server" | "worker"; message: string; path?: string | null; userId?: string | null; stackTop?: string | null }) {
  const message = scrubMessage(e.message || "Erro desconhecido");
  const path = scrubPath(e.path);
  const fingerprint = createHash("sha256")
    .update(`${e.source}|${message.slice(0, 120)}|${path ?? ""}|${scrubMessage(e.stackTop ?? "", 120)}`)
    .digest("hex")
    .slice(0, 32);
  try {
    const row = await db.errorEvent.upsert({
      where: { fingerprint },
      update: { count: { increment: 1 }, lastSeenAt: new Date(), lastUserId: e.userId ?? null },
      create: { fingerprint, source: e.source, message, path, lastUserId: e.userId ?? null },
    });
    await maybeNotifyAdmins(row.id);
  } catch {
    // nunca deixar o registro de erro derrubar a aplicação
  }
}

/** Avisa administradores (push) uma vez por dia por tipo de erro. */
async function maybeNotifyAdmins(errorId: string) {
  const row = await db.errorEvent.findUnique({ where: { id: errorId } });
  if (!row || (row.notifiedAt && Date.now() - row.notifiedAt.getTime() < 24 * 3600_000)) return;
  const claimed = await db.errorEvent.updateMany({
    where: { id: errorId, OR: [{ notifiedAt: null }, { notifiedAt: { lt: new Date(Date.now() - 24 * 3600_000) } }] },
    data: { notifiedAt: new Date() },
  });
  if (claimed.count !== 1) return;
  const subs = await db.pushSubscription.findMany({ where: { user: { role: "ADMIN", active: true } } });
  for (const s of subs) {
    const r = await sendPush(s, {
      title: "Erro no Visitas Locação",
      body: `${row.source === "client" ? "No aparelho" : row.source === "worker" ? "Na sincronização" : "No servidor"}: ${row.message.slice(0, 90)}`,
      url: "/admin/sincronizacao#erros",
      tag: `erro-${row.fingerprint}`,
    });
    if (r === "gone") await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}
