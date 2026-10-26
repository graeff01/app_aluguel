-- novas etapas do andamento (ordem da gestora): pré-análise, cadastro aprovado e vistoria/contrato ADM
ALTER TYPE "DealStage" ADD VALUE IF NOT EXISTS 'PRE_ANALYSIS' BEFORE 'KYC_SENT';
ALTER TYPE "DealStage" ADD VALUE IF NOT EXISTS 'APPROVED' AFTER 'DOCS';
ALTER TYPE "DealStage" ADD VALUE IF NOT EXISTS 'INSPECTION' AFTER 'APPROVED';
