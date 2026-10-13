/**
 * Zerar os dados de teste ANTES de começar a usar de verdade (admin, com confirmação digitada).
 * Apaga visitas, resultados, oportunidades, clientes, imóveis em cache, lembretes e erros registrados.
 * Mantém usuários, configurações, motivos, padrões, conexão com a agenda e a auditoria.
 * Eventos da agenda que geraram as visitas ficam marcados como ignorados (sem conteúdo) e não voltam.
 * Trava: só funciona com até WIPE_LIMIT visitas no sistema (depois disso o app já está em uso real).
 */
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assert, isAdmin, type AuthzActor } from "@/lib/authz";

export const WIPE_LIMIT = 60;
export const WIPE_PHRASE = "APAGAR";

export async function wipeAvailable() {
  return (await db.visit.count()) <= WIPE_LIMIT;
}

export async function wipeTestData(actor: AuthzActor, confirm: string, now = new Date()) {
  assert(isAdmin(actor));
  if (confirm.trim().toUpperCase() !== WIPE_PHRASE) throw new AppError("VALIDATION", `Digite ${WIPE_PHRASE} para confirmar.`, { confirm: `Digite ${WIPE_PHRASE}.` });
  return db.$transaction(
    async (tx) => {
      const visits = await tx.visit.count();
      if (visits > WIPE_LIMIT) throw new AppError("INVALID_STATE", `Há ${visits} visitas: o app já está em uso real. A limpeza total foi bloqueada para proteger os dados.`);
      const del: Record<string, number> = {};
      del.historico = (await tx.visitOutcomeHistory.deleteMany()).count;
      del.andamentos = (await tx.opportunityEvent.deleteMany()).count;
      await tx.visit.updateMany({ data: { opportunityId: null } });
      del.oportunidades = (await tx.opportunity.deleteMany()).count;
      del.visitas = (await tx.visit.deleteMany()).count;
      del.telefones = (await tx.clientPhone.deleteMany()).count;
      del.clientes = (await tx.client.deleteMany()).count;
      del.imoveis = (await tx.property.deleteMany()).count;
      del.lembretes = (await tx.reminderLog.deleteMany()).count;
      del.erros = (await tx.errorEvent.deleteMany()).count;
      // eventos da agenda: sem conteúdo e ignorados para sempre (evita reimportar o que ainda estiver no Google)
      del.eventosIgnorados = (
        await tx.sourceEvent.updateMany({
          data: { ignoredAt: now, title: null, description: null, organizerEmail: null, attendees: Prisma.DbNull, parsed: Prisma.DbNull, reviewDecision: "REJECTED" },
        })
      ).count;
      await audit(tx, { actorId: actor.id, action: "data.test_wipe", entityType: "System", entityId: "-", changes: del });
      return del;
    },
    { timeout: 30_000 },
  );
}
