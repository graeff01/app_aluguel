-- AlterTable
ALTER TABLE "PreAnalysis" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "awayUntil" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "PreAnalysis_requestId_key" ON "PreAnalysis"("requestId");

