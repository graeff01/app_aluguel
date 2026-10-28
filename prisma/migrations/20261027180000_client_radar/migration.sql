-- Radar de clientes: pedidos do pré-atendimento para a captação
CREATE TYPE "RadarStatus" AS ENUM ('SEARCHING', 'FOUND', 'CLOSED');

CREATE TABLE "ClientRadar" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "phoneEnc" TEXT,
    "phoneHash" TEXT,
    "clientId" TEXT,
    "wants" TEXT NOT NULL,
    "maxBudgetCents" INTEGER,
    "areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "propertyType" TEXT,
    "bedrooms" INTEGER,
    "sentToCaptureAt" TIMESTAMP(3),
    "status" "RadarStatus" NOT NULL DEFAULT 'SEARCHING',
    "foundCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "followUpOn" DATE NOT NULL,
    "lastUpdateAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeReason" TEXT,
    "closeNote" TEXT,
    "purgedAt" TIMESTAMP(3),
    CONSTRAINT "ClientRadar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RadarEvent" (
    "id" TEXT NOT NULL,
    "radarId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RadarEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientRadar_requestId_key" ON "ClientRadar"("requestId");
CREATE INDEX "ClientRadar_status_followUpOn_idx" ON "ClientRadar"("status", "followUpOn");
CREATE INDEX "RadarEvent_radarId_createdAt_idx" ON "RadarEvent"("radarId", "createdAt");

ALTER TABLE "ClientRadar" ADD CONSTRAINT "ClientRadar_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientRadar" ADD CONSTRAINT "ClientRadar_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientRadar" ADD CONSTRAINT "ClientRadar_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RadarEvent" ADD CONSTRAINT "RadarEvent_radarId_fkey" FOREIGN KEY ("radarId") REFERENCES "ClientRadar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RadarEvent" ADD CONSTRAINT "RadarEvent_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
