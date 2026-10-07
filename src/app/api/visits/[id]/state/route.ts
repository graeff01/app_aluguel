import type { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api";
import { db } from "@/lib/db";
import { canViewVisit } from "@/lib/authz";
import { notFound } from "@/lib/errors";

/** Versão atual (para resolver conflito sem perder o texto digitado). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return apiHandler(
    req,
    async (actor) => {
      const v = await db.visit.findUnique({ where: { id }, include: { concludedBy: { select: { name: true } }, negativeReason: true } });
      if (!v || !canViewVisit(actor, v)) throw notFound();
      return {
        version: v.version,
        status: v.status,
        evaluation: v.evaluation,
        negativeReason: v.negativeReason?.label ?? null,
        note: v.note,
        concludedBy: v.concludedBy?.name ?? null,
        concludedAt: v.concludedAt,
        clientName: v.clientName,
        propertyCode: v.propertyCode,
      };
    },
    { mutation: false },
  );
}
