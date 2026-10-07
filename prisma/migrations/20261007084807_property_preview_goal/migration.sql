-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "coverageGoal" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "propertyUrlTemplate" TEXT NOT NULL DEFAULT 'https://www.auxiliadorapredial.com.br/imovel/aluguel/{codigo}?tag=8086';

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "pageCheckedAt" TIMESTAMP(3),
ADD COLUMN     "pageStatus" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "title" TEXT;
