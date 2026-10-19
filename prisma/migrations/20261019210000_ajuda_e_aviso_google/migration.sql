-- Central de ajuda ("O que mudou" já visto) e aviso antes de a conexão Google expirar
ALTER TABLE "User" ADD COLUMN "seenChangelog" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "googleTestingMode" BOOLEAN NOT NULL DEFAULT true;
