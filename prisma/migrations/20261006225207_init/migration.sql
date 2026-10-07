-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'CONSULTANT');

-- CreateEnum
CREATE TYPE "PatternKind" AS ENUM ('VISIT_PREFIX', 'EXCLUDE', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "ReasonKind" AS ENUM ('VISIT_NEGATIVE', 'OPPORTUNITY_LOST');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EventClass" AS ENUM ('VISIT', 'AMBIGUOUS', 'IRRELEVANT');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('ACCEPTED_AS_VISIT', 'REJECTED');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('CONFIRMED', 'PENDING');

-- CreateEnum
CREATE TYPE "VisitOrigin" AS ENUM ('GOOGLE', 'MANUAL');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('SCHEDULED', 'DONE', 'NO_SHOW', 'CANCELED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "Evaluation" AS ENUM ('POSITIVE', 'NEGATIVE', 'UNDECIDED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('AUTO', 'MANUAL', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "ClientMatch" AS ENUM ('NEW_CONFIRMED', 'PHONE_MATCH', 'SUGGESTED', 'NO_PHONE', 'CONFIRMED_MANUAL');

-- CreateEnum
CREATE TYPE "SyncConflict" AS ENUM ('NONE', 'CANCELED_IN_GOOGLE', 'DELETED_IN_GOOGLE', 'NO_LONGER_VISIT', 'CHANGED_AFTER_CONCLUSION', 'POSSIBLE_RECREATION');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('FOLLOW_UP', 'DOCS_REVIEW', 'CLOSED_WON', 'LOST');

-- CreateEnum
CREATE TYPE "LostOrigin" AS ENUM ('VISIT_NEGATIVE', 'LATER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEmailAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEmailAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "productName" TEXT NOT NULL DEFAULT 'Visitas Locação',
    "primaryColor" TEXT NOT NULL DEFAULT '#1f5f8b',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "syncPastDays" INTEGER NOT NULL DEFAULT 30,
    "syncFutureDays" INTEGER NOT NULL DEFAULT 90,
    "manualSyncMinSeconds" INTEGER NOT NULL DEFAULT 60,
    "resultsStartDate" DATE NOT NULL,
    "consultantCanUpdateOpp" BOOLEAN NOT NULL DEFAULT true,
    "consultantCanCreateVisit" BOOLEAN NOT NULL DEFAULT true,
    "consultantCanCorrectData" BOOLEAN NOT NULL DEFAULT true,
    "noteMaxLength" INTEGER NOT NULL DEFAULT 2000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPattern" (
    "id" TEXT NOT NULL,
    "kind" "PatternKind" NOT NULL,
    "pattern" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reason" (
    "id" TEXT NOT NULL,
    "kind" "ReasonKind" NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleConnection" (
    "id" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "accessTokenEnc" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "statusDetail" TEXT,
    "calendarId" TEXT,
    "calendarSummary" TEXT,
    "calendarAccessRole" TEXT,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "beatAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "version" TEXT,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "calendarId" TEXT NOT NULL,
    "syncToken" TEXT,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "lastFullSyncAt" TIMESTAMP(3),
    "lastReconcileAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("calendarId")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "SyncRunStatus" NOT NULL,
    "mode" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "stats" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceEvent" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "recurringEventId" TEXT,
    "iCalUID" TEXT,
    "originalStartTime" TIMESTAMP(3),
    "googleStatus" TEXT NOT NULL,
    "googleUpdatedAt" TIMESTAMP(3),
    "etag" TEXT,
    "classification" "EventClass" NOT NULL,
    "reviewDecision" "ReviewDecision",
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "description" TEXT,
    "organizerEmail" TEXT,
    "attendees" JSONB,
    "attendeesOmitted" BOOLEAN NOT NULL DEFAULT false,
    "parsed" JSONB,
    "missingSince" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identityStatus" "IdentityStatus" NOT NULL DEFAULT 'PENDING',
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPhone" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "normalized" TEXT,
    "valid" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "origin" "VisitOrigin" NOT NULL,
    "sourceEventId" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "clientName" TEXT,
    "phoneRaw" TEXT,
    "phoneNormalized" TEXT,
    "propertyCode" TEXT,
    "externalRef" TEXT,
    "manualFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consultantId" TEXT,
    "assignmentStatus" "AssignmentStatus" NOT NULL,
    "assignmentNote" TEXT,
    "clientId" TEXT,
    "clientMatch" "ClientMatch" NOT NULL DEFAULT 'NO_PHONE',
    "clientCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "propertyId" TEXT,
    "opportunityId" TEXT,
    "status" "VisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "evaluation" "Evaluation",
    "negativeReasonId" TEXT,
    "note" TEXT,
    "concludedAt" TIMESTAMP(3),
    "concludedById" TEXT,
    "realizedById" TEXT,
    "autoCanceled" BOOLEAN NOT NULL DEFAULT false,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "syncConflict" "SyncConflict" NOT NULL DEFAULT 'NONE',
    "conflictDetail" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastRequestId" TEXT,
    "createRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitOutcomeHistory" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "status" "VisitStatus" NOT NULL,
    "evaluation" "Evaluation",
    "negativeReasonId" TEXT,
    "note" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitOutcomeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'FOLLOW_UP',
    "responsibleId" TEXT,
    "firstDoneVisitAt" TIMESTAMP(3) NOT NULL,
    "closedAt" DATE,
    "closedResponsibleId" TEXT,
    "lostAt" TIMESTAMP(3),
    "lostOrigin" "LostOrigin",
    "lostReasonId" TEXT,
    "lostNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityEvent" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromStatus" "OpportunityStatus",
    "toStatus" "OpportunityStatus" NOT NULL,
    "note" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserEmailAlias_email_key" ON "UserEmailAlias"("email");

-- CreateIndex
CREATE INDEX "UserEmailAlias_userId_idx" ON "UserEmailAlias"("userId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventPattern_kind_pattern_key" ON "EventPattern"("kind", "pattern");

-- CreateIndex
CREATE UNIQUE INDEX "Reason_kind_label_key" ON "Reason"("kind", "label");

-- CreateIndex
CREATE INDEX "SyncRun_status_createdAt_idx" ON "SyncRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRun_createdAt_idx" ON "SyncRun"("createdAt");

-- CreateIndex
CREATE INDEX "SourceEvent_classification_reviewDecision_idx" ON "SourceEvent"("classification", "reviewDecision");

-- CreateIndex
CREATE INDEX "SourceEvent_iCalUID_idx" ON "SourceEvent"("iCalUID");

-- CreateIndex
CREATE INDEX "SourceEvent_startAt_idx" ON "SourceEvent"("startAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceEvent_calendarId_googleEventId_key" ON "SourceEvent"("calendarId", "googleEventId");

-- CreateIndex
CREATE INDEX "Client_identityStatus_idx" ON "Client"("identityStatus");

-- CreateIndex
CREATE INDEX "ClientPhone_normalized_idx" ON "ClientPhone"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPhone_clientId_raw_key" ON "ClientPhone"("clientId", "raw");

-- CreateIndex
CREATE UNIQUE INDEX "Property_code_key" ON "Property"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_sourceEventId_key" ON "Visit"("sourceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_createRequestId_key" ON "Visit"("createRequestId");

-- CreateIndex
CREATE INDEX "Visit_consultantId_scheduledStart_idx" ON "Visit"("consultantId", "scheduledStart");

-- CreateIndex
CREATE INDEX "Visit_status_scheduledEnd_idx" ON "Visit"("status", "scheduledEnd");

-- CreateIndex
CREATE INDEX "Visit_scheduledStart_idx" ON "Visit"("scheduledStart");

-- CreateIndex
CREATE INDEX "Visit_clientId_idx" ON "Visit"("clientId");

-- CreateIndex
CREATE INDEX "Visit_propertyId_idx" ON "Visit"("propertyId");

-- CreateIndex
CREATE INDEX "Visit_opportunityId_idx" ON "Visit"("opportunityId");

-- CreateIndex
CREATE INDEX "Visit_phoneNormalized_idx" ON "Visit"("phoneNormalized");

-- CreateIndex
CREATE INDEX "VisitOutcomeHistory_visitId_createdAt_idx" ON "VisitOutcomeHistory"("visitId", "createdAt");

-- CreateIndex
CREATE INDEX "Opportunity_status_idx" ON "Opportunity"("status");

-- CreateIndex
CREATE INDEX "Opportunity_responsibleId_idx" ON "Opportunity"("responsibleId");

-- CreateIndex
CREATE INDEX "Opportunity_firstDoneVisitAt_idx" ON "Opportunity"("firstDoneVisitAt");

-- CreateIndex
CREATE INDEX "Opportunity_closedAt_idx" ON "Opportunity"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_clientId_propertyId_cycle_key" ON "Opportunity"("clientId", "propertyId", "cycle");

-- CreateIndex
CREATE INDEX "OpportunityEvent_opportunityId_createdAt_idx" ON "OpportunityEvent"("opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "UserEmailAlias" ADD CONSTRAINT "UserEmailAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleConnection" ADD CONSTRAINT "GoogleConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPhone" ADD CONSTRAINT "ClientPhone_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "SourceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_negativeReasonId_fkey" FOREIGN KEY ("negativeReasonId") REFERENCES "Reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_concludedById_fkey" FOREIGN KEY ("concludedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_realizedById_fkey" FOREIGN KEY ("realizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitOutcomeHistory" ADD CONSTRAINT "VisitOutcomeHistory_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitOutcomeHistory" ADD CONSTRAINT "VisitOutcomeHistory_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_closedResponsibleId_fkey" FOREIGN KEY ("closedResponsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_lostReasonId_fkey" FOREIGN KEY ("lostReasonId") REFERENCES "Reason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityEvent" ADD CONSTRAINT "OpportunityEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityEvent" ADD CONSTRAINT "OpportunityEvent_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Constraints adicionais (não expressáveis no schema Prisma) ──

-- No máximo uma oportunidade ativa por cliente+imóvel.
CREATE UNIQUE INDEX "Opportunity_one_active_per_client_property"
  ON "Opportunity" ("clientId", "propertyId")
  WHERE "status" IN ('FOLLOW_UP', 'DOCS_REVIEW');

-- Fechamento exige data e responsável; perda exige origem.
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_closed_requires_data"
  CHECK ("status" <> 'CLOSED_WON' OR ("closedAt" IS NOT NULL AND "closedResponsibleId" IS NOT NULL));
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_lost_requires_reason"
  CHECK ("status" <> 'LOST' OR ("lostOrigin" IS NOT NULL AND ("lostReasonId" IS NOT NULL OR "lostNote" IS NOT NULL)));

-- Avaliação só existe para visita realizada; negativa exige motivo.
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_evaluation_only_when_done"
  CHECK (("status" = 'DONE') = ("evaluation" IS NOT NULL));
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_negative_requires_reason"
  CHECK ("evaluation" IS DISTINCT FROM 'NEGATIVE' OR "negativeReasonId" IS NOT NULL);
-- Conclusão por pessoa exige observação não vazia (cancelamento automático do Google é a exceção).
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_conclusion_requires_note"
  CHECK ("status" = 'SCHEDULED' OR "autoCanceled" OR length(btrim(coalesce("note", ''))) > 0);
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_end_after_start"
  CHECK ("scheduledEnd" >= "scheduledStart");

-- Configuração é singleton.
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_singleton" CHECK ("id" = 1);
