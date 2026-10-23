-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('NEW', 'SENT', 'COUNTER', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "aftercareReferralAt" TIMESTAMP(3),
ADD COLUMN     "aftercareWelcomeAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aftercareSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "phoneEnc" TEXT,
    "phoneHash" TEXT,
    "clientId" TEXT,
    "rentCents" INTEGER NOT NULL,
    "propertyCode" TEXT NOT NULL,
    "ownClient" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'NEW',
    "counterCents" INTEGER,
    "resultNote" TEXT,
    "statusAt" TIMESTAMP(3),
    "statusById" TEXT,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_requestId_key" ON "Proposal"("requestId");

-- CreateIndex
CREATE INDEX "Proposal_consultantId_status_idx" ON "Proposal"("consultantId", "status");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE INDEX "Proposal_createdAt_idx" ON "Proposal"("createdAt");

-- CreateIndex
CREATE INDEX "Proposal_phoneHash_idx" ON "Proposal"("phoneHash");

-- CreateIndex
CREATE INDEX "Proposal_clientId_idx" ON "Proposal"("clientId");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_statusById_fkey" FOREIGN KEY ("statusById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
