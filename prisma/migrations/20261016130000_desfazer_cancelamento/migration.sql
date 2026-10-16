-- CreateTable
CREATE TABLE "VisitCancelUndo" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "visitIds" TEXT[],
    "calendarId" TEXT,
    "googleEventId" TEXT,
    "googleAction" TEXT,
    "previousSummary" TEXT,
    "newSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "VisitCancelUndo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitCancelUndo_createdAt_idx" ON "VisitCancelUndo"("createdAt");

