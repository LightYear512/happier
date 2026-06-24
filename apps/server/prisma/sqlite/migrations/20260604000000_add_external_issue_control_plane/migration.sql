-- DropIndex
DROP INDEX "AccountPetPackage_accountId_deletedAt_updatedAt_idx";

-- CreateTable
CREATE TABLE "RepositoryConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerBaseUrl" TEXT NOT NULL,
    "repositoryKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "authKind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "remoteCiDetected" BOOLEAN NOT NULL DEFAULT false,
    "pollerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pollingOwnerMachineId" TEXT,
    "pollingLeaseExpiresAt" DATETIME,
    "degradedReason" TEXT,
    "capabilities" JSONB,
    "installedAt" DATETIME,
    "lastCapabilitySyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RepositoryConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RepositoryConnection_pollingOwnerMachineId_fkey" FOREIGN KEY ("pollingOwnerMachineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExternalIssueRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
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
    "lastEventAt" DATETIME,
    "rawSnapshot" JSONB,
    "syncedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalIssueRef_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExternalIssueRef_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionIssueLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "externalIssueRefId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "resolutionReason" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deactivatedAt" DATETIME,
    CONSTRAINT "SessionIssueLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionIssueLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionIssueLink_externalIssueRefId_fkey" FOREIGN KEY ("externalIssueRefId") REFERENCES "ExternalIssueRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "externalIssueRefId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "triggerKind" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME,
    "claimedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "claimedByMachineId" TEXT,
    "leaseExpiresAt" DATETIME,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionRun_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionRun_externalIssueRefId_fkey" FOREIGN KEY ("externalIssueRefId") REFERENCES "ExternalIssueRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionRun_claimedByMachineId_fkey" FOREIGN KEY ("claimedByMachineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SessionRun_retryOfRunId_fkey" FOREIGN KEY ("retryOfRunId") REFERENCES "SessionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IssueExecutionProjection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "externalIssueRefId" TEXT NOT NULL,
    "workflowState" TEXT NOT NULL,
    "activePrimarySessionId" TEXT,
    "activePrimaryRunId" TEXT,
    "currentProviderChangeExternalId" TEXT,
    "currentProviderChangeUrl" TEXT,
    "subjectHeadSha" TEXT,
    "transitionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IssueExecutionProjection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueExecutionProjection_externalIssueRefId_fkey" FOREIGN KEY ("externalIssueRefId") REFERENCES "ExternalIssueRef" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueExecutionProjection_activePrimarySessionId_fkey" FOREIGN KEY ("activePrimarySessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IssueExecutionProjection_activePrimaryRunId_fkey" FOREIGN KEY ("activePrimaryRunId") REFERENCES "SessionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionRunEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "sessionRunId" TEXT NOT NULL,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    CONSTRAINT "SessionRunEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionRunEvent_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "SessionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderActionRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "sessionRunId" TEXT,
    "externalIssueRefId" TEXT,
    "provider" TEXT NOT NULL,
    "repositoryKey" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "targetMachineId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "claimedByExecutorId" TEXT,
    "claimedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "leaseExpiresAt" DATETIME,
    "payload" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerExternalId" TEXT,
    "resultSummary" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "lastAttemptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderActionRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderActionRequest_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderActionRequest_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "SessionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProviderActionRequest_externalIssueRefId_fkey" FOREIGN KEY ("externalIssueRefId") REFERENCES "ExternalIssueRef" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProviderActionRequest_targetMachineId_fkey" FOREIGN KEY ("targetMachineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "repositoryKey" TEXT NOT NULL,
    "requiresRemoteCi" BOOLEAN NOT NULL DEFAULT false,
    "allowsLocalVerifyFallback" BOOLEAN NOT NULL DEFAULT true,
    "autoMergeEligible" BOOLEAN NOT NULL DEFAULT false,
    "blockingSuites" JSONB,
    "localVerifyCommands" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VerificationPolicy_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VerificationPolicy_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "sessionRunId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "lifecycleState" TEXT NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "summary" TEXT,
    "rawExternalId" TEXT,
    "providerRunId" TEXT,
    "subjectHeadSha" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VerificationAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VerificationAttempt_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "SessionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationSuiteResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "verificationAttemptId" TEXT NOT NULL,
    "suiteKey" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "durationMs" INTEGER,
    "artifactUrl" TEXT,
    "summary" TEXT,
    CONSTRAINT "VerificationSuiteResult_verificationAttemptId_fkey" FOREIGN KEY ("verificationAttemptId") REFERENCES "VerificationAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationProjection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "sessionRunId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "blockingState" TEXT NOT NULL,
    "subjectHeadSha" TEXT,
    "suiteSummary" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VerificationProjection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VerificationProjection_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "SessionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MergeabilityProjection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "sessionRunId" TEXT NOT NULL,
    "mergeabilityState" TEXT NOT NULL,
    "requiredChecksOutstanding" INTEGER NOT NULL DEFAULT 0,
    "requiredReviewsRemaining" INTEGER NOT NULL DEFAULT 0,
    "subjectHeadSha" TEXT,
    "rawProjection" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MergeabilityProjection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MergeabilityProjection_sessionRunId_fkey" FOREIGN KEY ("sessionRunId") REFERENCES "SessionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExternalIssueSyncCursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "cursorKind" TEXT NOT NULL,
    "cursorValue" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalIssueSyncCursor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExternalIssueSyncCursor_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProviderEventReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "repositoryConnectionId" TEXT NOT NULL,
    "externalIssueRefId" TEXT,
    "provider" TEXT NOT NULL,
    "receiptKey" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderEventReceipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderEventReceipt_repositoryConnectionId_fkey" FOREIGN KEY ("repositoryConnectionId") REFERENCES "RepositoryConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderEventReceipt_externalIssueRefId_fkey" FOREIGN KEY ("externalIssueRefId") REFERENCES "ExternalIssueRef" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicKey" TEXT,
    "contentPublicKey" BLOB,
    "contentPublicKeySig" BLOB,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "changesFloor" INTEGER NOT NULL DEFAULT 0,
    "feedSeq" BIGINT NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "settings" TEXT,
    "settingsVersion" INTEGER NOT NULL DEFAULT 0,
    "encryptionMode" TEXT NOT NULL DEFAULT 'e2ee',
    "encryptionModeUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "avatar" JSONB
);
INSERT INTO "new_Account" ("avatar", "changesFloor", "contentPublicKey", "contentPublicKeySig", "createdAt", "encryptionMode", "encryptionModeUpdatedAt", "feedSeq", "firstName", "id", "lastName", "publicKey", "seq", "settings", "settingsVersion", "updatedAt", "username") SELECT "avatar", "changesFloor", "contentPublicKey", "contentPublicKeySig", "createdAt", "encryptionMode", "encryptionModeUpdatedAt", "feedSeq", "firstName", "id", "lastName", "publicKey", "seq", "settings", "settingsVersion", "updatedAt", "username" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_publicKey_key" ON "Account"("publicKey");
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");
CREATE TABLE "new_AccountIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "providerLogin" TEXT,
    "profile" JSONB,
    "token" BLOB,
    "scopes" TEXT,
    "showOnProfile" BOOLEAN NOT NULL DEFAULT true,
    "eligibilityStatus" TEXT NOT NULL DEFAULT 'unknown',
    "eligibilityReason" TEXT,
    "eligibilityCheckedAt" DATETIME,
    "eligibilityNextCheckAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountIdentity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AccountIdentity" ("accountId", "createdAt", "eligibilityCheckedAt", "eligibilityNextCheckAt", "eligibilityReason", "eligibilityStatus", "id", "profile", "provider", "providerLogin", "providerUserId", "scopes", "showOnProfile", "token", "updatedAt") SELECT "accountId", "createdAt", "eligibilityCheckedAt", "eligibilityNextCheckAt", "eligibilityReason", "eligibilityStatus", "id", "profile", "provider", "providerLogin", "providerUserId", "scopes", "showOnProfile", "token", "updatedAt" FROM "AccountIdentity";
DROP TABLE "AccountIdentity";
ALTER TABLE "new_AccountIdentity" RENAME TO "AccountIdentity";
CREATE INDEX "AccountIdentity_accountId_idx" ON "AccountIdentity"("accountId");
CREATE UNIQUE INDEX "AccountIdentity_provider_providerUserId_key" ON "AccountIdentity"("provider", "providerUserId");
CREATE UNIQUE INDEX "AccountIdentity_accountId_provider_key" ON "AccountIdentity"("accountId", "provider");
CREATE TABLE "new_AutomationRunEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    CONSTRAINT "AutomationRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AutomationRunEvent" ("id", "payload", "runId", "ts", "type") SELECT "id", "payload", "runId", "ts", "type" FROM "AutomationRunEvent";
DROP TABLE "AutomationRunEvent";
ALTER TABLE "new_AutomationRunEvent" RENAME TO "AutomationRunEvent";
CREATE INDEX "AutomationRunEvent_runId_ts_idx" ON "AutomationRunEvent"("runId", "ts");
CREATE INDEX "AutomationRunEvent_ts_idx" ON "AutomationRunEvent"("ts");
CREATE TABLE "new_SessionPendingMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "authorAccountId" TEXT,
    "localId" TEXT NOT NULL,
    "messageRole" TEXT,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "position" INTEGER NOT NULL,
    "discardedAt" DATETIME,
    "discardedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionPendingMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionPendingMessage_authorAccountId_fkey" FOREIGN KEY ("authorAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SessionPendingMessage" ("authorAccountId", "content", "createdAt", "discardedAt", "discardedReason", "id", "localId", "messageRole", "position", "sessionId", "status", "updatedAt") SELECT "authorAccountId", "content", "createdAt", "discardedAt", "discardedReason", "id", "localId", "messageRole", "position", "sessionId", "status", "updatedAt" FROM "SessionPendingMessage";
DROP TABLE "SessionPendingMessage";
ALTER TABLE "new_SessionPendingMessage" RENAME TO "SessionPendingMessage";
CREATE INDEX "SessionPendingMessage_sessionId_status_position_idx" ON "SessionPendingMessage"("sessionId", "status", "position");
CREATE INDEX "SessionPendingMessage_sessionId_authorAccountId_idx" ON "SessionPendingMessage"("sessionId", "authorAccountId");
CREATE INDEX "SessionPendingMessage_sessionId_status_updatedAt_idx" ON "SessionPendingMessage"("sessionId", "status", "updatedAt");
CREATE UNIQUE INDEX "SessionPendingMessage_sessionId_localId_key" ON "SessionPendingMessage"("sessionId", "localId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RepositoryConnection_accountId_enabled_updatedAt_idx" ON "RepositoryConnection"("accountId", "enabled", "updatedAt");

-- CreateIndex
CREATE INDEX "RepositoryConnection_accountId_mode_updatedAt_idx" ON "RepositoryConnection"("accountId", "mode", "updatedAt");

-- CreateIndex
CREATE INDEX "RepositoryConnection_pollingOwnerMachineId_pollingLeaseExpiresAt_idx" ON "RepositoryConnection"("pollingOwnerMachineId", "pollingLeaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryConnection_accountId_provider_providerBaseUrl_repositoryKey_key" ON "RepositoryConnection"("accountId", "provider", "providerBaseUrl", "repositoryKey");

-- CreateIndex
CREATE INDEX "ExternalIssueRef_repositoryConnectionId_issueNumber_idx" ON "ExternalIssueRef"("repositoryConnectionId", "issueNumber");

-- CreateIndex
CREATE INDEX "ExternalIssueRef_accountId_state_syncedAt_idx" ON "ExternalIssueRef"("accountId", "state", "syncedAt");

-- CreateIndex
CREATE INDEX "ExternalIssueRef_accountId_repositoryKey_updatedAt_idx" ON "ExternalIssueRef"("accountId", "repositoryKey", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIssueRef_accountId_provider_providerBaseUrl_repositoryKey_issueNumber_key" ON "ExternalIssueRef"("accountId", "provider", "providerBaseUrl", "repositoryKey", "issueNumber");

-- CreateIndex
CREATE INDEX "SessionIssueLink_externalIssueRefId_relation_active_idx" ON "SessionIssueLink"("externalIssueRefId", "relation", "active");

-- CreateIndex
CREATE INDEX "SessionIssueLink_sessionId_relation_active_idx" ON "SessionIssueLink"("sessionId", "relation", "active");

-- CreateIndex
CREATE INDEX "SessionIssueLink_sessionId_externalIssueRefId_relation_active_idx" ON "SessionIssueLink"("sessionId", "externalIssueRefId", "relation", "active");

-- CreateIndex
CREATE INDEX "SessionIssueLink_accountId_createdAt_idx" ON "SessionIssueLink"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionRun_accountId_state_scheduledAt_idx" ON "SessionRun"("accountId", "state", "scheduledAt");

-- CreateIndex
CREATE INDEX "SessionRun_sessionId_createdAt_idx" ON "SessionRun"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionRun_externalIssueRefId_createdAt_idx" ON "SessionRun"("externalIssueRefId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionRun_claimedByMachineId_leaseExpiresAt_idx" ON "SessionRun"("claimedByMachineId", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "SessionRun_providerChangeExternalId_headCommitSha_idx" ON "SessionRun"("providerChangeExternalId", "headCommitSha");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRun_accountId_idempotencyKey_key" ON "SessionRun"("accountId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "IssueExecutionProjection_externalIssueRefId_key" ON "IssueExecutionProjection"("externalIssueRefId");

-- CreateIndex
CREATE INDEX "IssueExecutionProjection_accountId_workflowState_updatedAt_idx" ON "IssueExecutionProjection"("accountId", "workflowState", "updatedAt");

-- CreateIndex
CREATE INDEX "IssueExecutionProjection_activePrimarySessionId_idx" ON "IssueExecutionProjection"("activePrimarySessionId");

-- CreateIndex
CREATE INDEX "IssueExecutionProjection_activePrimaryRunId_idx" ON "IssueExecutionProjection"("activePrimaryRunId");

-- CreateIndex
CREATE INDEX "SessionRunEvent_sessionRunId_ts_idx" ON "SessionRunEvent"("sessionRunId", "ts");

-- CreateIndex
CREATE INDEX "SessionRunEvent_accountId_ts_idx" ON "SessionRunEvent"("accountId", "ts");

-- CreateIndex
CREATE INDEX "ProviderActionRequest_accountId_state_createdAt_idx" ON "ProviderActionRequest"("accountId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderActionRequest_repositoryConnectionId_state_createdAt_idx" ON "ProviderActionRequest"("repositoryConnectionId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderActionRequest_targetMachineId_leaseExpiresAt_idx" ON "ProviderActionRequest"("targetMachineId", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ProviderActionRequest_sessionRunId_state_createdAt_idx" ON "ProviderActionRequest"("sessionRunId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderActionRequest_accountId_idempotencyKey_key" ON "ProviderActionRequest"("accountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "VerificationPolicy_accountId_repositoryKey_idx" ON "VerificationPolicy"("accountId", "repositoryKey");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationPolicy_repositoryConnectionId_key" ON "VerificationPolicy"("repositoryConnectionId");

-- CreateIndex
CREATE INDEX "VerificationAttempt_sessionRunId_createdAt_idx" ON "VerificationAttempt"("sessionRunId", "createdAt");

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
CREATE INDEX "VerificationProjection_accountId_headline_updatedAt_idx" ON "VerificationProjection"("accountId", "headline", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MergeabilityProjection_sessionRunId_key" ON "MergeabilityProjection"("sessionRunId");

-- CreateIndex
CREATE INDEX "MergeabilityProjection_accountId_mergeabilityState_updatedAt_idx" ON "MergeabilityProjection"("accountId", "mergeabilityState", "updatedAt");

-- CreateIndex
CREATE INDEX "ExternalIssueSyncCursor_accountId_observedAt_idx" ON "ExternalIssueSyncCursor"("accountId", "observedAt");

-- CreateIndex
CREATE INDEX "ExternalIssueSyncCursor_observedAt_idx" ON "ExternalIssueSyncCursor"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIssueSyncCursor_repositoryConnectionId_cursorKind_key" ON "ExternalIssueSyncCursor"("repositoryConnectionId", "cursorKind");

-- CreateIndex
CREATE INDEX "ProviderEventReceipt_accountId_firstSeenAt_idx" ON "ProviderEventReceipt"("accountId", "firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEventReceipt_repositoryConnectionId_receiptKey_key" ON "ProviderEventReceipt"("repositoryConnectionId", "receiptKey");

-- CreateIndex
CREATE INDEX "AccountPetPackage_accountId_deletedAt_updatedAt_idx" ON "AccountPetPackage"("accountId", "deletedAt", "updatedAt");

