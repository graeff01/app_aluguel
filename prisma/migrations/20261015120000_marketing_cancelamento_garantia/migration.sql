-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReasonKind" ADD VALUE 'VISIT_CANCEL';
ALTER TYPE "ReasonKind" ADD VALUE 'GUARANTEE';
ALTER TYPE "ReasonKind" ADD VALUE 'LEASE_HIGHLIGHT';
ALTER TYPE "ReasonKind" ADD VALUE 'LEASE_AGENT';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MARKETING';

-- AlterTable
ALTER TABLE "PreAnalysis" ADD COLUMN     "guaranteeId" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "cancelReasonId" TEXT;

-- CreateTable
CREATE TABLE "LeasePost" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "highlightNote" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,

    CONSTRAINT "LeasePost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeasePost_opportunityId_key" ON "LeasePost"("opportunityId");

-- CreateIndex
CREATE INDEX "LeasePost_postedAt_idx" ON "LeasePost"("postedAt");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_cancelReasonId_fkey" FOREIGN KEY ("cancelReasonId") REFERENCES "Reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAnalysis" ADD CONSTRAINT "PreAnalysis_guaranteeId_fkey" FOREIGN KEY ("guaranteeId") REFERENCES "Reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeasePost" ADD CONSTRAINT "LeasePost_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeasePost" ADD CONSTRAINT "LeasePost_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Reason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeasePost" ADD CONSTRAINT "LeasePost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeasePost" ADD CONSTRAINT "LeasePost_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

