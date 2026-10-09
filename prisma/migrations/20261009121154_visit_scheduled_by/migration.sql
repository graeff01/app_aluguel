-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "scheduledById" TEXT;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_scheduledById_fkey" FOREIGN KEY ("scheduledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Visitas cadastradas no app: quem agendou é quem fez o cadastro (registrado na auditoria).
UPDATE "Visit" v
SET "scheduledById" = a."actorId"
FROM "AuditLog" a
WHERE a."action" = 'visit.created_manual'
  AND a."entityType" = 'Visit'
  AND a."entityId" = v."id"
  AND a."actorId" IS NOT NULL
  AND v."scheduledById" IS NULL;
