-- CreateEnum
CREATE TYPE "ClientSearchStatus" AS ENUM ('ACTIVE', 'WON', 'LOST_ELSEWHERE', 'GAVE_UP');

-- CreateTable
CREATE TABLE "ClientSearch" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "status" "ClientSearchStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxBudgetCents" INTEGER,
    "areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "propertyType" TEXT,
    "bedrooms" INTEGER,
    "mustNot" TEXT,
    "note" TEXT,
    "sourceVisitId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastContactAt" TIMESTAMP(3),
    "followUpOn" DATE,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeNote" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientSearch_consultantId_status_idx" ON "ClientSearch"("consultantId", "status");

-- CreateIndex
CREATE INDEX "ClientSearch_clientId_status_idx" ON "ClientSearch"("clientId", "status");

-- CreateIndex
CREATE INDEX "ClientSearch_status_followUpOn_idx" ON "ClientSearch"("status", "followUpOn");

-- AddForeignKey
ALTER TABLE "ClientSearch" ADD CONSTRAINT "ClientSearch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSearch" ADD CONSTRAINT "ClientSearch_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSearch" ADD CONSTRAINT "ClientSearch_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- No máximo uma busca ativa por cliente
CREATE UNIQUE INDEX "ClientSearch_one_active_per_client" ON "ClientSearch"("clientId") WHERE "status" = 'ACTIVE';
