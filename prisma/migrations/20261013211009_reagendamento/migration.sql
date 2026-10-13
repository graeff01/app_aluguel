-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "linkCode" TEXT,
ADD COLUMN     "rescheduledFromId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Visit_linkCode_key" ON "Visit"("linkCode");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

