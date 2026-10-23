-- Documentos pelo link do cliente: desligado por decisão da gestão (pode ser religado em Regras e app)
ALTER TABLE "AppSettings" ADD COLUMN "docLinksEnabled" BOOLEAN NOT NULL DEFAULT false;
