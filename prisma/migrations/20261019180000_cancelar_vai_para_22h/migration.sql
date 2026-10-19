-- Cancelar pelo app move o evento para as 22h (o desfazer volta para o horário original)
ALTER TABLE "VisitCancelUndo" ADD COLUMN "previousStart" TIMESTAMP(3),
ADD COLUMN "previousEnd" TIMESTAMP(3);
