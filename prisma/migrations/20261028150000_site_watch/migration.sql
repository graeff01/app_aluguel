-- vigia do site (radar e clientes em busca) e aviso de anúncio que saiu antes da visita
ALTER TABLE "ClientRadar" ADD COLUMN "siteSeenCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ClientRadar" ADD COLUMN "siteNewCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ClientRadar" ADD COLUMN "siteCheckedAt" TIMESTAMP(3);
ALTER TABLE "ClientSearch" ADD COLUMN "siteSeenCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ClientSearch" ADD COLUMN "siteNewCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ClientSearch" ADD COLUMN "siteCheckedAt" TIMESTAMP(3);
ALTER TABLE "ClientSearch" ADD COLUMN "sentCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Visit" ADD COLUMN "listingGoneAt" TIMESTAMP(3);
