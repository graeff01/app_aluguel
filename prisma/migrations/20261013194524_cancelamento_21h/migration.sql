-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "cancelAfterHour" INTEGER NOT NULL DEFAULT 21,
ADD COLUMN     "preAnalysisRetentionDays" INTEGER NOT NULL DEFAULT 90;

