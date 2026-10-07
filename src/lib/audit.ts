import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "./db";

export async function audit(
  tx: Tx,
  entry: { actorId: string | null; action: string; entityType: string; entityId: string; changes?: Prisma.InputJsonValue },
) {
  await tx.auditLog.create({ data: entry });
}

/** Diferença campo a campo (para auditoria). */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const out: Record<string, { de: Prisma.InputJsonValue | null; para: Prisma.InputJsonValue | null }> = {};
  for (const [k, v] of Object.entries(after)) {
    const b = before[k];
    const same = b instanceof Date && v instanceof Date ? b.getTime() === v.getTime() : JSON.stringify(b) === JSON.stringify(v);
    if (!same) out[k] = { de: toJson(b), para: toJson(v) };
  }
  return out;
}

function toJson(v: unknown): Prisma.InputJsonValue | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  return v as Prisma.InputJsonValue;
}
