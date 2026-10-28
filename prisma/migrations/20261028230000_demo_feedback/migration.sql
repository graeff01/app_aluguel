-- sugestões da demonstração pública (sem login)
CREATE TABLE "DemoFeedback" (
    "id" TEXT NOT NULL,
    "demo" TEXT NOT NULL,
    "name" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DemoFeedback_demo_createdAt_idx" ON "DemoFeedback"("demo", "createdAt");
