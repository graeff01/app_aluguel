-- a Jasmin prefere a agenda como já é (visitas das consultoras em branco, por não estarem aceitas): sem pintura no Google
ALTER TABLE "AppSettings" ALTER COLUMN "consultantEventColor" SET DEFAULT '';
UPDATE "AppSettings" SET "consultantEventColor" = '' WHERE "consultantEventColor" = '3';
ALTER TABLE "SourceEvent" ADD COLUMN "paintedColorId" TEXT;
-- o que já foi pintado antes desta versão foi com a cor "3"
UPDATE "SourceEvent" SET "paintedColorId" = '3' WHERE "colorPaintedAt" IS NOT NULL;
