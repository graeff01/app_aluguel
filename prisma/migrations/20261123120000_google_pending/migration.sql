-- fila do que não chegou à agenda Google (conexão fora): reenviado ao reconectar
ALTER TABLE "Visit" ADD COLUMN "googlePending" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Visit" ADD COLUMN "googlePendingAt" TIMESTAMP(3);
CREATE INDEX "Visit_googlePendingAt_idx" ON "Visit"("googlePendingAt");
