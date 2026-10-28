-- "fora do perfil": opções do site recusadas e o que o app aprende com elas
ALTER TABLE "ClientRadar" ADD COLUMN "rejectedCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ClientRadar" ADD COLUMN "siteRules" JSONB;
ALTER TABLE "ClientSearch" ADD COLUMN "rejectedCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ClientSearch" ADD COLUMN "siteRules" JSONB;
