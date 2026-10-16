-- AlterEnum
ALTER TYPE "ReasonKind" ADD VALUE 'PRE_MISSING';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "msgAfterNegative" TEXT NOT NULL DEFAULT 'Olá, {cliente}! Aqui é {consultora}, da Auxiliadora Predial. Obrigada pela visita ao imóvel {codigo}. Tenho outras opções no perfil que você procura. Posso te enviar algumas?',
ADD COLUMN     "msgAfterNoShow" TEXT NOT NULL DEFAULT 'Olá, {cliente}! Aqui é {consultora}, da Auxiliadora Predial. Senti sua falta na visita ao imóvel {codigo}. Quer remarcar? Me diga o melhor dia e horário para você.',
ADD COLUMN     "msgAfterPositive" TEXT NOT NULL DEFAULT 'Olá, {cliente}! Aqui é {consultora}, da Auxiliadora Predial. Que bom que você gostou do imóvel {codigo}! Para seguirmos com a locação, me envie por aqui: documento com foto (RG ou CNH), comprovante de renda dos últimos 3 meses e comprovante de residência. Qualquer dúvida, estou à disposição.',
ADD COLUMN     "msgAfterUndecided" TEXT NOT NULL DEFAULT 'Olá, {cliente}! Aqui é {consultora}, da Auxiliadora Predial. Ficou alguma dúvida sobre o imóvel {codigo}? Posso te ajudar a decidir ou te mostrar outras opções parecidas.';

-- AlterTable
ALTER TABLE "PreAnalysis" ADD COLUMN     "missingItems" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "googleCreatedAt" TIMESTAMP(3);

