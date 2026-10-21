-- CreateEnum
CREATE TYPE "DocRequestStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CANCELED');

-- CreateTable
CREATE TABLE "DocRequest" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEnc" TEXT,
    "preAnalysisId" TEXT,
    "opportunityId" TEXT,
    "visitId" TEXT,
    "consultantId" TEXT,
    "createdById" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "phoneEnc" TEXT,
    "verifyKind" TEXT NOT NULL,
    "verifyHash" TEXT,
    "items" JSONB NOT NULL,
    "message" TEXT,
    "propertyCode" TEXT,
    "status" "DocRequestStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "DocRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocRequest_tokenHash_key" ON "DocRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "DocRequest_preAnalysisId_idx" ON "DocRequest"("preAnalysisId");

-- CreateIndex
CREATE INDEX "DocRequest_opportunityId_idx" ON "DocRequest"("opportunityId");

-- CreateIndex
CREATE INDEX "DocRequest_visitId_idx" ON "DocRequest"("visitId");

-- CreateIndex
CREATE INDEX "DocRequest_status_expiresAt_idx" ON "DocRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "DocRequest_createdAt_idx" ON "DocRequest"("createdAt");

-- CreateIndex
CREATE INDEX "ClientDocument_requestId_itemKey_idx" ON "ClientDocument"("requestId", "itemKey");

-- AddForeignKey
ALTER TABLE "DocRequest" ADD CONSTRAINT "DocRequest_preAnalysisId_fkey" FOREIGN KEY ("preAnalysisId") REFERENCES "PreAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocRequest" ADD CONSTRAINT "DocRequest_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocRequest" ADD CONSTRAINT "DocRequest_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocRequest" ADD CONSTRAINT "DocRequest_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocRequest" ADD CONSTRAINT "DocRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DocRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
