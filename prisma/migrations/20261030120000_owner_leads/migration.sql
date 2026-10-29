-- mapa animado da demanda (coordenadas dos bairros) e contatos de proprietários da página "Quanto rende o seu imóvel?"
CREATE TABLE "AreaGeo" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "geocodedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AreaGeo_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "OwnerLead" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "phoneEnc" TEXT,
    "phoneHash" TEXT,
    "area" TEXT NOT NULL,
    "propertyType" TEXT NOT NULL,
    "bedrooms" INTEGER,
    "wantedCents" INTEGER,
    "estimateCents" INTEGER,
    "demand" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "handlerId" TEXT,
    "note" TEXT,
    "closedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OwnerLead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OwnerLead_status_createdAt_idx" ON "OwnerLead"("status", "createdAt");
ALTER TABLE "OwnerLead" ADD CONSTRAINT "OwnerLead_handlerId_fkey" FOREIGN KEY ("handlerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
