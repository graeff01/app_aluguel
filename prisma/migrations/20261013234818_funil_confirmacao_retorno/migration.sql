-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "confirmMessage" TEXT NOT NULL DEFAULT 'Olá, {cliente}! Aqui é {consultora}, da Auxiliadora Predial. Confirmando sua visita {dia} às {hora} no imóvel {codigo}{bairro}. Posso contar com você?';

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "confirmStatus" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "followUpDoneAt" TIMESTAMP(3),
ADD COLUMN     "followUpOn" DATE,
ADD COLUMN     "preAnalysisId" TEXT;

-- CreateIndex
CREATE INDEX "Visit_consultantId_followUpOn_idx" ON "Visit"("consultantId", "followUpOn");

-- CreateIndex
CREATE INDEX "Visit_preAnalysisId_idx" ON "Visit"("preAnalysisId");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_preAnalysisId_fkey" FOREIGN KEY ("preAnalysisId") REFERENCES "PreAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

