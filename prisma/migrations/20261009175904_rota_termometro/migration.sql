-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "managerAlertHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "resultPromptEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "resultReminderHours" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "address" TEXT,
ADD COLUMN     "addressSource" TEXT,
ADD COLUMN     "addressUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "area" INTEGER,
ADD COLUMN     "bedrooms" INTEGER,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "neighborhood" TEXT,
ADD COLUMN     "rent" INTEGER,
ADD COLUMN     "totalPrice" INTEGER;

-- relê as páginas dos imóveis para preencher tipo, bairro e valores
UPDATE "Property" SET "pageCheckedAt" = NULL;
