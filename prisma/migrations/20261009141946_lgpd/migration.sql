-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "privacyContact" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "retentionLastRunAt" TIMESTAMP(3),
ADD COLUMN     "retentionMonths" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "privacyAcceptedAt" TIMESTAMP(3);
