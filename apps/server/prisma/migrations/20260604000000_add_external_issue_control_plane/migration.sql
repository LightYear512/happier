-- CreateEnum
CREATE TYPE "RepositoryProviderKind" AS ENUM ('github', 'gitlab');

-- CreateEnum
CREATE TYPE "RepositoryConnectionMode" AS ENUM ('quickstart', 'managed');

-- CreateEnum
CREATE TYPE "RepositoryAuthKind" AS ENUM ('github_app', 'gitlab_token', 'gh_cli', 'glab_cli', 'user_pat');

-- CreateEnum
CREATE TYPE "SessionIssueRelation" AS ENUM ('primary', 'context');

-- CreateEnum
CREATE TYPE "SessionRunState" AS ENUM ('queued', 'claimed', 'running', 'waiting_user', 'succeeded', 'failed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "ProviderActionKind" AS ENUM ('comment', 'label_sync', 'assignee_sync', 'issue_link_back', 'open_change', 'update_change', 'close_issue');

-- CreateEnum
CREATE TYPE "VerificationSource" AS ENUM ('remote_ci', 'local_runtime', 'manual_override');

-- CreateEnum
CREATE TYPE "VerificationLifecycleState" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out');

-- CreateEnum
CREATE TYPE "VerificationConclusion" AS ENUM ('passed', 'failed', 'pending', 'skipped', 'neutral', 'action_required', 'unknown');

-- CreateEnum
CREATE TYPE "VerificationProjectionHeadline" AS ENUM ('verified_remote', 'verified_local_only', 'partially_verified', 'unverified', 'verification_failed', 'verification_pending');

-- CreateEnum
CREATE TYPE "VerificationBlockingState" AS ENUM ('clear', 'warning', 'blocked');

-- CreateEnum
CREATE TYPE "ProviderActionExecutionMode" AS ENUM ('server_worker', 'machine_runtime');

-- CreateEnum
CREATE TYPE "ProviderActionState" AS ENUM ('queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "IssueWorkflowState" AS ENUM ('idle', 'executing', 'change_open', 'awaiting_review', 'done');

-- CreateEnum
CREATE TYPE "MergeabilityState" AS ENUM ('mergeable', 'blocked_required_checks', 'blocked_reviews', 'blocked_conflicts', 'draft', 'unknown');

-- CreateTable
CREATE TABLE "RepositoryConnection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "RepositoryProviderKind" NOT NULL,
    "providerBaseUrl" TEXT NOT NULL,
    "repositoryKey" TEXT NOT NULL,
    "mode" "RepositoryConnectionMode" NOT NULL,
    "authKind" "RepositoryAuthKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "remoteCiDetected" BOOLEAN NOT NULL DEFAULT false,
    "pollerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pollingOwnerMachineId" TEXT,
    "pollingLeaseExpiresAt" TIMESTAMP(3),
    "degradedReason" TEXT,
    "capabilities" JSONB,
    "installedAt" TIMESTAMP(3),
    "lastCapabilitySyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIssueRef" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "provider" "RepositoryProviderKind" NOT NULL,
    "providerBaseUrl" TEXT NOT NULL,
    "repositoryKey" TEXT NOT NULL,
    "providerIssueExternalId" TEXT,
    "issueNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "labels" JSONB,
    "assignees" JSONB,
    "url" TEXT NOT NULL,
    "lastEventKey" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "rawSnapshot" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIssueRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionIssueLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "externalIssueRefId" TEXT NOT NULL,
    "relation" "SessionIssueRelation" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "resolutionReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "SessionIssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRun" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "externalIssueRefId" TEXT NOT NULL,
    "state" "SessionRunState" NOT NULL DEFAULT 'queued',
    "triggerKind" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "claimedByMachineId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "branchName" TEXT,
    "providerChangeUrl" TEXT,
    "providerChangeNumber" INTEGER,
    "providerChangeExternalId" TEXT,
    "headCommitSha" TEXT,
    "baseCommitSha" TEXT,
    "summaryCiphertext" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryOfRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueExecutionProjection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalIssueRefId" TEXT NOT NULL,
    "workflowState" "IssueWorkflowState" NOT NULL,
    "activePrimarySessionId" TEXT,
    "activePrimaryRunId" TEXT,
    "currentProviderChangeExternalId" TEXT,
    "currentProviderChangeUrl" TEXT,
    "subjectHeadSha" TEXT,
    "transitionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueExecutionProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRunEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionRunId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "payload" JSONB,

    CONSTRAINT "SessionRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderActionRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "sessionRunId" TEXT,
    "externalIssueRefId" TEXT,
    "provider" "RepositoryProviderKind" NOT NULL,
    "repositoryKey" TEXT NOT NULL,
    "actionKind" "ProviderActionKind" NOT NULL,
    "executionMode" "ProviderActionExecutionMode" NOT NULL,
    "state" "ProviderActionState" NOT NULL DEFAULT 'queued',
    "targetMachineId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "claimedByExecutorId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerExternalId" TEXT,
    "resultSummary" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "lastAttemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationPolicy" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "repositoryKey" TEXT NOT NULL,
    "requiresRemoteCi" BOOLEAN NOT NULL DEFAULT false,
    "allowsLocalVerifyFallback" BOOLEAN NOT NULL DEFAULT true,
    "autoMergeEligible" BOOLEAN NOT NULL DEFAULT false,
    "blockingSuites" JSONB,
    "localVerifyCommands" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationAttempt" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionRunId" TEXT NOT NULL,
    "source" "VerificationSource" NOT NULL,
    "lifecycleState" "VerificationLifecycleState" NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "summary" TEXT,
    "rawExternalId" TEXT,
    "providerRunId" TEXT,
    "subjectHeadSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationSuiteResult" (
    "id" TEXT NOT NULL,
    "verificationAttemptId" TEXT NOT NULL,
    "suiteKey" TEXT NOT NULL,
    "conclusion" "VerificationConclusion" NOT NULL,
    "durationMs" INTEGER,
    "artifactUrl" TEXT,
    "summary" TEXT,

    CONSTRAINT "VerificationSuiteResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationProjection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionRunId" TEXT NOT NULL,
    "headline" "VerificationProjectionHeadline" NOT NULL,
    "blockingState" "VerificationBlockingState" NOT NULL,
    "subjectHeadSha" TEXT,
    "suiteSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MergeabilityProjection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionRunId" TEXT NOT NULL,
    "mergeabilityState" "MergeabilityState" NOT NULL,
    "requiredChecksOutstanding" INTEGER NOT NULL DEFAULT 0,
    "requiredReviewsRemaining" INTEGER NOT NULL DEFAULT 0,
    "subjectHeadSha" TEXT,
    "rawProjection" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MergeabilityProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIssueSyncCursor" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "cursorKind" TEXT NOT NULL,
    "cursorValue" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIssueSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEventReceipt" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "externalIssueRefId" TEXT,
    "provider" "RepositoryProviderKind" NOT NULL,
    "receiptKey" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderEventReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepositoryConnection_accountId_enabled_updatedAt_idx" ON "RepositoryConnection"("accountId", "enabled", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "RepositoryConnection_accountId_mode_updatedAt_idx" ON "RepositoryConnection"("accountId", "mode", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "RepositoryConnection_pollingOwnerMachineId_pollingLeaseExpiresAt_idx" ON "RepositoryConnection"("pollingOwnerMachineId", "pollingLeaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryConnection_accountId_provider_providerBaseUrl_repositoryKey_key" ON "RepositoryConnection"("accountId", "provider", "providerBaseUrl", "repositoryKey");

-- CreateIndex
CREATE INDEX "ExternalIssueRef_repositoryConnectionId_issueNumber_idx" ON "ExternalIssueRef"("repositoryConnectionId", "issueNumber");

-- CreateIndex
CREATE INDEX "ExternalIssueRef_accountId_state_syncedAt_idx" ON "ExternalIssueRef"("accountId", "state", "syncedAt" DESC);

-- CreateIndex
CREATE INDEX "ExternalIssueRef_accountId_repositoryKey_updatedAt_idx" ON "ExternalIssueRef"("accountId", "repositoryKey", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIssueRef_accountId_provider_providerBaseUrl_repositoryKey_issueNumber_key" ON "ExternalIssueRef"("accountId", "provider", "providerBaseUrl", "repositoryKey", "issueNumber");

-- CreateIndex
CREATE INDEX "SessionIssueLink_externalIssueRefId_relation_active_idx" ON "SessionIssueLink"("externalIssueRefId", "relation", "active");

-- CreateIndex
CREATE INDEX "SessionIssueLink_sessionId_relation_active_idx" ON "SessionIssueLink"("sessionId", "relation", "active");

-- CreateIndex
CREATE INDEX "SessionIssueLink_sessionId_externalIssueRefId_relation_active_idx" ON "SessionIssueLink"("sessionId", "externalIssueRefId", "relation", "active");

-- CreateIndex
CREATE INDEX "SessionIssueLink_accountId_createdAt_idx" ON "SessionIssueLink"("accountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SessionRun_accountId_state_scheduledAt_idx" ON "SessionRun"("accountId", "state", "scheduledAt" DESC);

-- CreateIndex
CREATE INDEX "SessionRun_sessionId_createdAt_idx" ON "SessionRun"("sessionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SessionRun_externalIssueRefId_createdAt_idx" ON "SessionRun"("externalIssueRefId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SessionRun_claimedByMachineId_leaseExpiresAt_idx" ON "SessionRun"("claimedByMachineId", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "SessionRun_providerChangeExternalId_headCommitSha_idx" ON "SessionRun"("providerChangeExternalId", "headCommitSha");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRun_accountId_idempotencyKey_key" ON "SessionRun"("accountId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "IssueExecutionProjection_externalIssueRefId_key" ON "IssueExecutionProjection"("externalIssueRefId");

-- CreateIndex
CREATE INDEX "IssueExecutionProjection_accountId_workflowState_updatedAt_idx" ON "IssueExecutionProjection"("accountId", "workflowState", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "IssueExecutionProjection_activePrimarySessionId_idx" ON "IssueExecutionProjection"("activePrimarySessionId");

-- CreateIndex
CREATE INDEX "IssueExecutionProjection_activePrimaryRunId_idx" ON "IssueExecutionProjection"("activePrimaryRunId");

-- CreateIndex
CREATE INDEX "SessionRunEvent_sessionRunId_ts_idx" ON "SessionRunEvent"("sessionRunId", "ts");

-- CreateIndex
CREATE INDEX "SessionRunEvent_accountId_ts_idx" ON "SessionRunEvent"("accountId", "ts");

-- CreateIndex
CREATE INDEX "ProviderActionRequest_accountId_state_createdAt_idx" ON "ProviderActionRequest"("accountId", "state", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ProviderActionRequest_repositoryConnectionId_state_createdAt_idx" ON "ProviderActionRequest"("repositoryConnectionId", "state", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ProviderActionRequest_targetMachineId_leaseExpiresAt_idx" ON "ProviderActionRequest"("targetMachineId", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ProviderActionRequest_sessionRunId_state_createdAt_idx" ON "ProviderActionRequest"("sessionRunId", "state", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderActionRequest_accountId_idempotencyKey_key" ON "ProviderActionRequest"("accountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "VerificationPolicy_accountId_repositoryKey_idx" ON "VerificationPolicy"("accountId", "repositoryKey");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationPolicy_repositoryConnectionId_key" ON "VerificationPolicy"("repositoryConnectionId");

-- CreateIndex
CREATE INDEX "VerificationAttempt_sessionRunId_createdAt_idx" ON "VerificationAttempt"("sessionRunId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VerificationAttempt_accountId_providerRunId_idx" ON "VerificationAttempt"("accountId", "providerRunId");

-- CreateIndex
CREATE INDEX "VerificationAttempt_accountId_subjectHeadSha_idx" ON "VerificationAttempt"("accountId", "subjectHeadSha");

-- CreateIndex
CREATE INDEX "VerificationSuiteResult_suiteKey_conclusion_idx" ON "VerificationSuiteResult"("suiteKey", "conclusion");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationSuiteResult_verificationAttemptId_suiteKey_key" ON "VerificationSuiteResult"("verificationAttemptId", "suiteKey");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationProjection_sessionRunId_key" ON "VerificationProjection"("sessionRunId");

-- CreateIndex
CREATE INDEX "VerificationProjection_accountId_headline_updatedAt_idx" ON "VerificationProjection"("accountId", "headline", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "MergeabilityProjection_sessionRunId_key" ON "MergeabilityProjection"("sessionRunId");

-- CreateIndex
CREATE INDEX "MergeabilityProjection_accountId_mergeabilityState_updatedAt_idx" ON "MergeabilityProjection"("accountId", "mergeabilityState", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "ExternalIssueSyncCursor_accountId_observedAt_idx" ON "ExternalIssueSyncCursor"("accountId", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "ExternalIssueSyncCursor_observedAt_idx" ON "ExternalIssueSyncCursor"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIssueSyncCursor_repositoryConnectionId_cursorKind_key" ON "ExternalIssueSyncCursor"("repositoryConnectionId", "cursorKind");

-- CreateIndex
CREATE INDEX "ProviderEventReceipt_accountId_firstSeenAt_idx" ON "ProviderEventReceipt"("accountId", "firstSeenAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEventReceipt_repositoryConnectionId_receiptKey_key" ON "ProviderEventReceipt"("repositoryConnectionId", "receiptKey");

-- AddForeignKey
ALTER TABLE "RepositoryConnection" ADD CONSTRAINT "RepositoryConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryConnection" ADD CONSTRAINT "RepositoryConnection_pollingOwnerMachineId_fkey" FOREIGN KEY ("pollingOwnerMachineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIssueRef" ADD CONSTRAINT "ExternalIssueRef_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIssueRef" ADD CONSTRAINT "ExternalIssueRef_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionIssueLink" ADD CONSTRAINT "SessionIssueLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionIssueLink" ADD CONSTRAINT "SessionIssueLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionIssueLink" ADD CONSTRAINT "SessionIssueLink_externalIssueRefId_fkey" FOREIGN KEY ("externalIssueRefId") REFERENCES "ExternalIssueRef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRun" ADD CONSTRAINT "SessionRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRun" ADD CONSTRAINT "SessionRun_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRun" ADD CONSTRAINT "SessionRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRun" ADD CONSTRAINT "SessionRun_externalIssueRefId_fkey" FOREIGN KEY ("externalIssueRefId") REFERENCES "ExternalIssueRef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRun" ADD CONSTRAINT "SessionRun_claimedByMachineId_fkey" FOREIGN KEY ("claimedByMachineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRun" ADD CONSTRAINT "SessionRun_retryOfRunId_fkey" FOREIGN KEY ("retryOfRunId") REFERENCES "SessionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueExecutionProjection" ADD CONSTRAINT "IssueExecutionProjection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueExecutionProjection" ADD CONSTRAINT "IssueExecutionProjection_externalIssueRefId_fkey" FOREIGN KEY ("externalIssueRefId") REFERENCES "ExternalIssueRef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueExecutionProjection" ADD CONSTRAINT "IssueExecutionProjection_activePrimarySessionId_fkey" FOREIGN KEY ("activePrimarySessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueExecutionProjection" ADD CONSTRAINT "IssueExecutionProjection_activePrimaryRunId_fkey" FOREIGN KEY ("activePrimaryRunId") REFERENCES "SessionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRunEvent" ADD CONSTRAINT "SessionRunEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRunEvent" ADD CONSTRAINT "SessionRunEvent_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "SessionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderActionRequest" ADD CONSTRAINT "ProviderActionRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderActionRequest" ADD CONSTRAINT "ProviderActionRequest_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderActionRequest" ADD CONSTRAINT "ProviderActionRequest_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "SessionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderActionRequest" ADD CONSTRAINT "ProviderActionRequest_externalIssueRefId_fkey" FOREIGN KEY ("externalIssueRefId") REFERENCES "ExternalIssueRef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderActionRequest" ADD CONSTRAINT "ProviderActionRequest_targetMachineId_fkey" FOREIGN KEY ("targetMachineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationPolicy" ADD CONSTRAINT "VerificationPolicy_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationPolicy" ADD CONSTRAINT "VerificationPolicy_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "SessionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationSuiteResult" ADD CONSTRAINT "VerificationSuiteResult_verificationAttemptId_fkey" FOREIGN KEY ("verificationAttemptId") REFERENCES "VerificationAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationProjection" ADD CONSTRAINT "VerificationProjection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationProjection" ADD CONSTRAINT "VerificationProjection_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "SessionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeabilityProjection" ADD CONSTRAINT "MergeabilityProjection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeabilityProjection" ADD CONSTRAINT "MergeabilityProjection_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "SessionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIssueSyncCursor" ADD CONSTRAINT "ExternalIssueSyncCursor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIssueSyncCursor" ADD CONSTRAINT "ExternalIssueSyncCursor_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEventReceipt" ADD CONSTRAINT "ProviderEventReceipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEventReceipt" ADD CONSTRAINT "ProviderEventReceipt_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEventReceipt" ADD CONSTRAINT "ProviderEventReceipt_externalIssueRefId_fkey" FOREIGN KEY ("externalIssueRefId") REFERENCES "ExternalIssueRef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
