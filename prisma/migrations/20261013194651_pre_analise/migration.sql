-- CreateEnum
CREATE TYPE "PreAnalysisStatus" AS ENUM ('AWAITING', 'APPROVED', 'REJECTED', 'PENDING');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PRE_SERVICE';

-- CreateTable
CREATE TABLE "PreAnalysis" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "status" "PreAnalysisStatus" NOT NULL DEFAULT 'AWAITING',
    "fullName" TEXT NOT NULL,
    "cpfHash" TEXT,
    "cpfEnc" TEXT,
    "birthDateEnc" TEXT,
    "emailEnc" TEXT,
    "phoneEnc" TEXT,
    "salaryEnc" TEXT,
    "incomeBand" TEXT NOT NULL,
    "propertyCode" TEXT,
    "note" TEXT,
    "resultNote" TEXT,
    "resultAt" TIMESTAMP(3),
    "resultById" TEXT,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "PreAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreAnalysis_consultantId_status_idx" ON "PreAnalysis"("consultantId", "status");

-- CreateIndex
CREATE INDEX "PreAnalysis_createdAt_idx" ON "PreAnalysis"("createdAt");

-- CreateIndex
CREATE INDEX "PreAnalysis_cpfHash_idx" ON "PreAnalysis"("cpfHash");

-- AddForeignKey
ALTER TABLE "PreAnalysis" ADD CONSTRAINT "PreAnalysis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAnalysis" ADD CONSTRAINT "PreAnalysis_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAnalysis" ADD CONSTRAINT "PreAnalysis_resultById_fkey" FOREIGN KEY ("resultById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

