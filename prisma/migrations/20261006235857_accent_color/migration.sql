-- AlterTable
ALTER TABLE "AppSettings" ALTER COLUMN "primaryColor" SET DEFAULT '#dc7519';
UPDATE "AppSettings" SET "primaryColor" = '#dc7519' WHERE "primaryColor" = '#1f5f8b';
