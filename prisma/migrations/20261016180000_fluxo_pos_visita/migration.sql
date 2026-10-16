-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('NEGOTIATION', 'OWNER_PENDING', 'KYC_SENT', 'ANALYSIS', 'DOCS', 'CONTRACT', 'SIGNED', 'POSSESSION');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('LEASE', 'INTERMEDIATION');

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "agreedRentCents" INTEGER,
ADD COLUMN     "analysisDecidedAt" DATE,
ADD COLUMN     "contractReleasedAt" DATE,
ADD COLUMN     "contractSentAt" DATE,
ADD COLUMN     "contractValueCents" INTEGER,
ADD COLUMN     "dealType" "DealType",
ADD COLUMN     "docsMissing" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "docsRequestedAt" DATE,
ADD COLUMN     "guarantee" TEXT,
ADD COLUMN     "inspectionNeeded" BOOLEAN,
ADD COLUMN     "intendedGuarantee" TEXT,
ADD COLUMN     "keysHolderChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kycDueAt" DATE,
ADD COLUMN     "kycSentAt" DATE,
ADD COLUMN     "lostStage" "DealStage",
ADD COLUMN     "ownerAcceptedAt" DATE,
ADD COLUMN     "possessionAt" DATE,
ADD COLUMN     "proposalSentAt" DATE,
ADD COLUMN     "proposedRentCents" INTEGER,
ADD COLUMN     "signedAt" DATE,
ADD COLUMN     "stage" "DealStage",
ADD COLUMN     "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "OpportunityEvent" ADD COLUMN     "fromStage" "DealStage",
ADD COLUMN     "toStage" "DealStage";


-- Negócios que já existem: situação equivalente
UPDATE "Opportunity" SET "stage" = 'NEGOTIATION' WHERE "status" = 'FOLLOW_UP' AND EXISTS (SELECT 1 FROM "Visit" v WHERE v."opportunityId" = "Opportunity"."id" AND v."evaluation" = 'POSITIVE');
UPDATE "Opportunity" SET "stage" = 'DOCS' WHERE "status" = 'DOCS_REVIEW';
UPDATE "Opportunity" SET "stage" = 'SIGNED', "signedAt" = "closedAt" WHERE "status" = 'CLOSED_WON';
UPDATE "Opportunity" SET "stageChangedAt" = "updatedAt";
