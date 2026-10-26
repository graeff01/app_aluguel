-- "Aguardando documentação" antiga era a etapa depois da análise aprovada: vira "Cadastro aprovado"
UPDATE "Opportunity" SET "stage" = 'APPROVED' WHERE "stage" = 'DOCS';
UPDATE "Opportunity" SET "lostStage" = 'APPROVED' WHERE "lostStage" = 'DOCS';
UPDATE "OpportunityEvent" SET "fromStage" = 'APPROVED' WHERE "fromStage" = 'DOCS';
UPDATE "OpportunityEvent" SET "toStage" = 'APPROVED' WHERE "toStage" = 'DOCS';
