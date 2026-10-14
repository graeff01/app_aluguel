-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "companionOfId" TEXT;

-- CreateIndex
CREATE INDEX "Visit_companionOfId_idx" ON "Visit"("companionOfId");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_companionOfId_fkey" FOREIGN KEY ("companionOfId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

