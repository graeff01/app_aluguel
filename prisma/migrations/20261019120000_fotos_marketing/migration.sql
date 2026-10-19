-- Fotos do anúncio guardadas para o marketing (o anúncio sai do site depois de alugado)
ALTER TABLE "Property" ADD COLUMN "gallery" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "LeasePost" ADD COLUMN "photosStatus" TEXT,
ADD COLUMN "photosCheckedAt" TIMESTAMP(3),
ADD COLUMN "photoAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "LeasePhoto" (
    "id" TEXT NOT NULL,
    "leasePostId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeasePhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeasePhoto_leasePostId_sourceUrl_key" ON "LeasePhoto"("leasePostId", "sourceUrl");
CREATE INDEX "LeasePhoto_leasePostId_position_idx" ON "LeasePhoto"("leasePostId", "position");

ALTER TABLE "LeasePhoto" ADD CONSTRAINT "LeasePhoto_leasePostId_fkey" FOREIGN KEY ("leasePostId") REFERENCES "LeasePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
