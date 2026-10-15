-- CreateTable
CREATE TABLE "PreAnalysisFile" (
    "id" TEXT NOT NULL,
    "preAnalysisId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreAnalysisFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreAnalysisFile_preAnalysisId_idx" ON "PreAnalysisFile"("preAnalysisId");

-- AddForeignKey
ALTER TABLE "PreAnalysisFile" ADD CONSTRAINT "PreAnalysisFile_preAnalysisId_fkey" FOREIGN KEY ("preAnalysisId") REFERENCES "PreAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAnalysisFile" ADD CONSTRAINT "PreAnalysisFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

