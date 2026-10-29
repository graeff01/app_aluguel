-- imóveis de aluguel da Auxiliadora em Canoas lidos do site (Mapa de Canoas)
CREATE TABLE "SiteInventory" (
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT,
    "bedrooms" INTEGER,
    "rentCents" INTEGER,
    "totalCents" INTEGER,
    "neighborhood" TEXT,
    "areaKey" TEXT,
    "photoUrl" TEXT,
    "url" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "goneAt" TIMESTAMP(3),
    CONSTRAINT "SiteInventory_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "SiteInventory_areaKey_goneAt_idx" ON "SiteInventory"("areaKey", "goneAt");
CREATE INDEX "SiteInventory_goneAt_lastSeenAt_idx" ON "SiteInventory"("goneAt", "lastSeenAt");
