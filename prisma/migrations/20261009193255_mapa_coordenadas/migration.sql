-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "geoPrecision" TEXT,
ADD COLUMN     "geoQuery" TEXT,
ADD COLUMN     "geocodedAt" TIMESTAMP(3),
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;
