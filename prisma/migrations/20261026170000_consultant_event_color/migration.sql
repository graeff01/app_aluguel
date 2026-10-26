ALTER TABLE "AppSettings" ADD COLUMN "consultantEventColor" TEXT NOT NULL DEFAULT '3';
ALTER TABLE "SourceEvent" ADD COLUMN "colorId" TEXT;
ALTER TABLE "SourceEvent" ADD COLUMN "colorPaintedAt" TIMESTAMP(3);
