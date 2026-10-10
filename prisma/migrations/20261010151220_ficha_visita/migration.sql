-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "condoFee" INTEGER,
ADD COLUMN     "iptu" INTEGER,
ADD COLUMN     "photos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- relê os anúncios para condomínio, IPTU e fotos
UPDATE "Property" SET "pageCheckedAt" = NULL;
