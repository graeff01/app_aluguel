-- leitura de mercado da captação: parecer por pedido do radar e por perfil (bairro + tipo)
ALTER TABLE "ClientRadar" ADD COLUMN "marketTag" TEXT;
ALTER TABLE "ClientRadar" ADD COLUMN "marketNote" TEXT;
ALTER TABLE "ClientRadar" ADD COLUMN "marketCents" INTEGER;
ALTER TABLE "ClientRadar" ADD COLUMN "marketNoteAt" TIMESTAMP(3);
ALTER TABLE "ClientRadar" ADD COLUMN "marketNoteById" TEXT;
CREATE TABLE "MarketNote" (
    "id" TEXT NOT NULL,
    "areaKey" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL DEFAULT '',
    "area" TEXT NOT NULL,
    "type" TEXT,
    "tag" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "cents" INTEGER,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketNote_areaKey_typeKey_key" ON "MarketNote"("areaKey", "typeKey");
