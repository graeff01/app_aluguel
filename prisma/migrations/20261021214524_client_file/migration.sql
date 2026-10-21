-- AlterTable
ALTER TABLE "PreAnalysis" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "phoneHash" TEXT;

-- CreateIndex
CREATE INDEX "PreAnalysis_phoneHash_idx" ON "PreAnalysis"("phoneHash");

-- CreateIndex
CREATE INDEX "PreAnalysis_clientId_idx" ON "PreAnalysis"("clientId");

-- AddForeignKey
ALTER TABLE "PreAnalysis" ADD CONSTRAINT "PreAnalysis_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ficha do cliente: pré-análises que já viraram visita ganham o cadastro do cliente da visita.
-- (As demais são ligadas pelo telefone pelo worker, que calcula a impressão cifrada do número.)
UPDATE "PreAnalysis" p
SET "clientId" = v."clientId"
FROM "Visit" v
WHERE v."preAnalysisId" = p."id" AND v."clientId" IS NOT NULL AND p."clientId" IS NULL;
