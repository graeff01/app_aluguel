-- captação: pedido da consultora (a partir do cliente em busca), "estou buscando" e indicações (retorno e placar)
ALTER TABLE "ClientRadar" ADD COLUMN "searchId" TEXT;
ALTER TABLE "ClientRadar" ADD COLUMN "captureOwnerId" TEXT;
ALTER TABLE "ClientRadar" ADD COLUMN "captureOwnerAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ClientRadar_searchId_key" ON "ClientRadar"("searchId");
ALTER TABLE "ClientRadar" ADD CONSTRAINT "ClientRadar_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "ClientSearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientRadar" ADD CONSTRAINT "ClientRadar_captureOwnerId_fkey" FOREIGN KEY ("captureOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CaptureIndication" (
    "id" TEXT NOT NULL,
    "radarId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOutcome" TEXT,
    CONSTRAINT "CaptureIndication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CaptureIndication_radarId_code_key" ON "CaptureIndication"("radarId", "code");
CREATE INDEX "CaptureIndication_byId_createdAt_idx" ON "CaptureIndication"("byId", "createdAt");
ALTER TABLE "CaptureIndication" ADD CONSTRAINT "CaptureIndication_radarId_fkey" FOREIGN KEY ("radarId") REFERENCES "ClientRadar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaptureIndication" ADD CONSTRAINT "CaptureIndication_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
