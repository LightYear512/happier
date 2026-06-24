-- CreateTable
CREATE TABLE `RepositoryConnection` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `provider` ENUM('github', 'gitlab') NOT NULL,
    `providerBaseUrl` VARCHAR(191) NOT NULL,
    `repositoryKey` VARCHAR(191) NOT NULL,
    `mode` ENUM('quickstart', 'managed') NOT NULL,
    `authKind` ENUM('github_app', 'gitlab_token', 'gh_cli', 'glab_cli', 'user_pat') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `webhookEnabled` BOOLEAN NOT NULL DEFAULT false,
    `remoteCiDetected` BOOLEAN NOT NULL DEFAULT false,
    `pollerEnabled` BOOLEAN NOT NULL DEFAULT false,
    `pollingOwnerMachineId` VARCHAR(191) NULL,
    `pollingLeaseExpiresAt` DATETIME(3) NULL,
    `degradedReason` VARCHAR(191) NULL,
    `capabilities` JSON NULL,
    `installedAt` DATETIME(3) NULL,
    `lastCapabilitySyncAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RepositoryConnection_accountId_enabled_updatedAt_idx`(`accountId`, `enabled`, `updatedAt`),
    INDEX `RepositoryConnection_accountId_mode_updatedAt_idx`(`accountId`, `mode`, `updatedAt`),
    INDEX `RepositoryConnection_pollingOwnerMachineId_pollingLeaseExpir_idx`(`pollingOwnerMachineId`, `pollingLeaseExpiresAt`),
    UNIQUE INDEX `RepositoryConnection_accountId_provider_providerBaseUrl_repo_key`(`accountId`, `provider`, `providerBaseUrl`, `repositoryKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExternalIssueRef` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `repositoryConnectionId` VARCHAR(191) NOT NULL,
    `provider` ENUM('github', 'gitlab') NOT NULL,
    `providerBaseUrl` VARCHAR(191) NOT NULL,
    `repositoryKey` VARCHAR(191) NOT NULL,
    `providerIssueExternalId` VARCHAR(191) NULL,
    `issueNumber` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `labels` JSON NULL,
    `assignees` JSON NULL,
    `url` VARCHAR(191) NOT NULL,
    `lastEventKey` VARCHAR(191) NULL,
    `lastEventAt` DATETIME(3) NULL,
    `rawSnapshot` JSON NULL,
    `syncedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ExternalIssueRef_repositoryConnectionId_issueNumber_idx`(`repositoryConnectionId`, `issueNumber`),
    INDEX `ExternalIssueRef_accountId_state_syncedAt_idx`(`accountId`, `state`, `syncedAt`),
    INDEX `ExternalIssueRef_accountId_repositoryKey_updatedAt_idx`(`accountId`, `repositoryKey`, `updatedAt`),
    UNIQUE INDEX `ExternalIssueRef_accountId_provider_providerBaseUrl_reposito_key`(`accountId`, `provider`, `providerBaseUrl`, `repositoryKey`, `issueNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionIssueLink` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `externalIssueRefId` VARCHAR(191) NOT NULL,
    `relation` ENUM('primary', 'context') NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `resolutionReason` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deactivatedAt` DATETIME(3) NULL,

    INDEX `SessionIssueLink_externalIssueRefId_relation_active_idx`(`externalIssueRefId`, `relation`, `active`),
    INDEX `SessionIssueLink_sessionId_relation_active_idx`(`sessionId`, `relation`, `active`),
    INDEX `SessionIssueLink_sessionId_externalIssueRefId_relation_activ_idx`(`sessionId`, `externalIssueRefId`, `relation`, `active`),
    INDEX `SessionIssueLink_accountId_createdAt_idx`(`accountId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionRun` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `repositoryConnectionId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `externalIssueRefId` VARCHAR(191) NOT NULL,
    `state` ENUM('queued', 'claimed', 'running', 'waiting_user', 'succeeded', 'failed', 'cancelled', 'expired') NOT NULL DEFAULT 'queued',
    `triggerKind` VARCHAR(191) NOT NULL,
    `scheduledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueAt` DATETIME(3) NULL,
    `claimedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `claimedByMachineId` VARCHAR(191) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `attempt` INTEGER NOT NULL DEFAULT 0,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `generation` INTEGER NOT NULL DEFAULT 0,
    `branchName` VARCHAR(191) NULL,
    `providerChangeUrl` VARCHAR(191) NULL,
    `providerChangeNumber` INTEGER NULL,
    `providerChangeExternalId` VARCHAR(191) NULL,
    `headCommitSha` VARCHAR(191) NULL,
    `baseCommitSha` VARCHAR(191) NULL,
    `summaryCiphertext` VARCHAR(191) NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` VARCHAR(191) NULL,
    `retryOfRunId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SessionRun_accountId_state_scheduledAt_idx`(`accountId`, `state`, `scheduledAt`),
    INDEX `SessionRun_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    INDEX `SessionRun_externalIssueRefId_createdAt_idx`(`externalIssueRefId`, `createdAt`),
    INDEX `SessionRun_claimedByMachineId_leaseExpiresAt_idx`(`claimedByMachineId`, `leaseExpiresAt`),
    INDEX `SessionRun_providerChangeExternalId_headCommitSha_idx`(`providerChangeExternalId`, `headCommitSha`),
    UNIQUE INDEX `SessionRun_accountId_idempotencyKey_key`(`accountId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IssueExecutionProjection` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `externalIssueRefId` VARCHAR(191) NOT NULL,
    `workflowState` ENUM('idle', 'executing', 'change_open', 'awaiting_review', 'done') NOT NULL,
    `activePrimarySessionId` VARCHAR(191) NULL,
    `activePrimaryRunId` VARCHAR(191) NULL,
    `currentProviderChangeExternalId` VARCHAR(191) NULL,
    `currentProviderChangeUrl` VARCHAR(191) NULL,
    `subjectHeadSha` VARCHAR(191) NULL,
    `transitionReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IssueExecutionProjection_externalIssueRefId_key`(`externalIssueRefId`),
    INDEX `IssueExecutionProjection_accountId_workflowState_updatedAt_idx`(`accountId`, `workflowState`, `updatedAt`),
    INDEX `IssueExecutionProjection_activePrimarySessionId_idx`(`activePrimarySessionId`),
    INDEX `IssueExecutionProjection_activePrimaryRunId_idx`(`activePrimaryRunId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionRunEvent` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `sessionRunId` VARCHAR(191) NOT NULL,
    `ts` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `type` VARCHAR(191) NOT NULL,
    `payload` JSON NULL,

    INDEX `SessionRunEvent_sessionRunId_ts_idx`(`sessionRunId`, `ts`),
    INDEX `SessionRunEvent_accountId_ts_idx`(`accountId`, `ts`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderActionRequest` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `repositoryConnectionId` VARCHAR(191) NOT NULL,
    `sessionRunId` VARCHAR(191) NULL,
    `externalIssueRefId` VARCHAR(191) NULL,
    `provider` ENUM('github', 'gitlab') NOT NULL,
    `repositoryKey` VARCHAR(191) NOT NULL,
    `actionKind` ENUM('comment', 'label_sync', 'assignee_sync', 'issue_link_back', 'open_change', 'update_change', 'close_issue') NOT NULL,
    `executionMode` ENUM('server_worker', 'machine_runtime') NOT NULL,
    `state` ENUM('queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled', 'expired') NOT NULL DEFAULT 'queued',
    `targetMachineId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `claimedByExecutorId` VARCHAR(191) NULL,
    `claimedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `payload` JSON NOT NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `providerExternalId` VARCHAR(191) NULL,
    `resultSummary` VARCHAR(191) NULL,
    `lastErrorCode` VARCHAR(191) NULL,
    `lastErrorMessage` VARCHAR(191) NULL,
    `lastAttemptedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProviderActionRequest_accountId_state_createdAt_idx`(`accountId`, `state`, `createdAt`),
    INDEX `ProviderActionRequest_repositoryConnectionId_state_createdAt_idx`(`repositoryConnectionId`, `state`, `createdAt`),
    INDEX `ProviderActionRequest_targetMachineId_leaseExpiresAt_idx`(`targetMachineId`, `leaseExpiresAt`),
    INDEX `ProviderActionRequest_sessionRunId_state_createdAt_idx`(`sessionRunId`, `state`, `createdAt`),
    UNIQUE INDEX `ProviderActionRequest_accountId_idempotencyKey_key`(`accountId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationPolicy` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `repositoryConnectionId` VARCHAR(191) NOT NULL,
    `repositoryKey` VARCHAR(191) NOT NULL,
    `requiresRemoteCi` BOOLEAN NOT NULL DEFAULT false,
    `allowsLocalVerifyFallback` BOOLEAN NOT NULL DEFAULT true,
    `autoMergeEligible` BOOLEAN NOT NULL DEFAULT false,
    `blockingSuites` JSON NULL,
    `localVerifyCommands` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VerificationPolicy_accountId_repositoryKey_idx`(`accountId`, `repositoryKey`),
    UNIQUE INDEX `VerificationPolicy_repositoryConnectionId_key`(`repositoryConnectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `sessionRunId` VARCHAR(191) NOT NULL,
    `source` ENUM('remote_ci', 'local_runtime', 'manual_override') NOT NULL,
    `lifecycleState` ENUM('queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out') NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `summary` VARCHAR(191) NULL,
    `rawExternalId` VARCHAR(191) NULL,
    `providerRunId` VARCHAR(191) NULL,
    `subjectHeadSha` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VerificationAttempt_sessionRunId_createdAt_idx`(`sessionRunId`, `createdAt`),
    INDEX `VerificationAttempt_accountId_providerRunId_idx`(`accountId`, `providerRunId`),
    INDEX `VerificationAttempt_accountId_subjectHeadSha_idx`(`accountId`, `subjectHeadSha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationSuiteResult` (
    `id` VARCHAR(191) NOT NULL,
    `verificationAttemptId` VARCHAR(191) NOT NULL,
    `suiteKey` VARCHAR(191) NOT NULL,
    `conclusion` ENUM('passed', 'failed', 'pending', 'skipped', 'neutral', 'action_required', 'unknown') NOT NULL,
    `durationMs` INTEGER NULL,
    `artifactUrl` VARCHAR(191) NULL,
    `summary` VARCHAR(191) NULL,

    INDEX `VerificationSuiteResult_suiteKey_conclusion_idx`(`suiteKey`, `conclusion`),
    UNIQUE INDEX `VerificationSuiteResult_verificationAttemptId_suiteKey_key`(`verificationAttemptId`, `suiteKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationProjection` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `sessionRunId` VARCHAR(191) NOT NULL,
    `headline` ENUM('verified_remote', 'verified_local_only', 'partially_verified', 'unverified', 'verification_failed', 'verification_pending') NOT NULL,
    `blockingState` ENUM('clear', 'warning', 'blocked') NOT NULL,
    `subjectHeadSha` VARCHAR(191) NULL,
    `suiteSummary` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `VerificationProjection_sessionRunId_key`(`sessionRunId`),
    INDEX `VerificationProjection_accountId_headline_updatedAt_idx`(`accountId`, `headline`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MergeabilityProjection` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `sessionRunId` VARCHAR(191) NOT NULL,
    `mergeabilityState` ENUM('mergeable', 'blocked_required_checks', 'blocked_reviews', 'blocked_conflicts', 'draft', 'unknown') NOT NULL,
    `requiredChecksOutstanding` INTEGER NOT NULL DEFAULT 0,
    `requiredReviewsRemaining` INTEGER NOT NULL DEFAULT 0,
    `subjectHeadSha` VARCHAR(191) NULL,
    `rawProjection` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MergeabilityProjection_sessionRunId_key`(`sessionRunId`),
    INDEX `MergeabilityProjection_accountId_mergeabilityState_updatedAt_idx`(`accountId`, `mergeabilityState`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExternalIssueSyncCursor` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `repositoryConnectionId` VARCHAR(191) NOT NULL,
    `cursorKind` VARCHAR(191) NOT NULL,
    `cursorValue` VARCHAR(191) NOT NULL,
    `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ExternalIssueSyncCursor_accountId_observedAt_idx`(`accountId`, `observedAt`),
    INDEX `ExternalIssueSyncCursor_observedAt_idx`(`observedAt`),
    UNIQUE INDEX `ExternalIssueSyncCursor_repositoryConnectionId_cursorKind_key`(`repositoryConnectionId`, `cursorKind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderEventReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `repositoryConnectionId` VARCHAR(191) NOT NULL,
    `externalIssueRefId` VARCHAR(191) NULL,
    `provider` ENUM('github', 'gitlab') NOT NULL,
    `receiptKey` VARCHAR(191) NOT NULL,
    `eventKind` VARCHAR(191) NOT NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProviderEventReceipt_accountId_firstSeenAt_idx`(`accountId`, `firstSeenAt`),
    UNIQUE INDEX `ProviderEventReceipt_repositoryConnectionId_receiptKey_key`(`repositoryConnectionId`, `receiptKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RepositoryConnection` ADD CONSTRAINT `RepositoryConnection_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RepositoryConnection` ADD CONSTRAINT `RepositoryConnection_pollingOwnerMachineId_fkey` FOREIGN KEY (`pollingOwnerMachineId`) REFERENCES `Machine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExternalIssueRef` ADD CONSTRAINT `ExternalIssueRef_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExternalIssueRef` ADD CONSTRAINT `ExternalIssueRef_repositoryConnectionId_fkey` FOREIGN KEY (`repositoryConnectionId`) REFERENCES `RepositoryConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionIssueLink` ADD CONSTRAINT `SessionIssueLink_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionIssueLink` ADD CONSTRAINT `SessionIssueLink_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionIssueLink` ADD CONSTRAINT `SessionIssueLink_externalIssueRefId_fkey` FOREIGN KEY (`externalIssueRefId`) REFERENCES `ExternalIssueRef`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionRun` ADD CONSTRAINT `SessionRun_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionRun` ADD CONSTRAINT `SessionRun_repositoryConnectionId_fkey` FOREIGN KEY (`repositoryConnectionId`) REFERENCES `RepositoryConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionRun` ADD CONSTRAINT `SessionRun_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionRun` ADD CONSTRAINT `SessionRun_externalIssueRefId_fkey` FOREIGN KEY (`externalIssueRefId`) REFERENCES `ExternalIssueRef`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionRun` ADD CONSTRAINT `SessionRun_claimedByMachineId_fkey` FOREIGN KEY (`claimedByMachineId`) REFERENCES `Machine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionRun` ADD CONSTRAINT `SessionRun_retryOfRunId_fkey` FOREIGN KEY (`retryOfRunId`) REFERENCES `SessionRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IssueExecutionProjection` ADD CONSTRAINT `IssueExecutionProjection_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IssueExecutionProjection` ADD CONSTRAINT `IssueExecutionProjection_externalIssueRefId_fkey` FOREIGN KEY (`externalIssueRefId`) REFERENCES `ExternalIssueRef`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IssueExecutionProjection` ADD CONSTRAINT `IssueExecutionProjection_activePrimarySessionId_fkey` FOREIGN KEY (`activePrimarySessionId`) REFERENCES `Session`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IssueExecutionProjection` ADD CONSTRAINT `IssueExecutionProjection_activePrimaryRunId_fkey` FOREIGN KEY (`activePrimaryRunId`) REFERENCES `SessionRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionRunEvent` ADD CONSTRAINT `SessionRunEvent_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionRunEvent` ADD CONSTRAINT `SessionRunEvent_sessionRunId_fkey` FOREIGN KEY (`sessionRunId`) REFERENCES `SessionRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderActionRequest` ADD CONSTRAINT `ProviderActionRequest_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderActionRequest` ADD CONSTRAINT `ProviderActionRequest_repositoryConnectionId_fkey` FOREIGN KEY (`repositoryConnectionId`) REFERENCES `RepositoryConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderActionRequest` ADD CONSTRAINT `ProviderActionRequest_sessionRunId_fkey` FOREIGN KEY (`sessionRunId`) REFERENCES `SessionRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderActionRequest` ADD CONSTRAINT `ProviderActionRequest_externalIssueRefId_fkey` FOREIGN KEY (`externalIssueRefId`) REFERENCES `ExternalIssueRef`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderActionRequest` ADD CONSTRAINT `ProviderActionRequest_targetMachineId_fkey` FOREIGN KEY (`targetMachineId`) REFERENCES `Machine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationPolicy` ADD CONSTRAINT `VerificationPolicy_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationPolicy` ADD CONSTRAINT `VerificationPolicy_repositoryConnectionId_fkey` FOREIGN KEY (`repositoryConnectionId`) REFERENCES `RepositoryConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationAttempt` ADD CONSTRAINT `VerificationAttempt_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationAttempt` ADD CONSTRAINT `VerificationAttempt_sessionRunId_fkey` FOREIGN KEY (`sessionRunId`) REFERENCES `SessionRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationSuiteResult` ADD CONSTRAINT `VerificationSuiteResult_verificationAttemptId_fkey` FOREIGN KEY (`verificationAttemptId`) REFERENCES `VerificationAttempt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationProjection` ADD CONSTRAINT `VerificationProjection_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationProjection` ADD CONSTRAINT `VerificationProjection_sessionRunId_fkey` FOREIGN KEY (`sessionRunId`) REFERENCES `SessionRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MergeabilityProjection` ADD CONSTRAINT `MergeabilityProjection_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MergeabilityProjection` ADD CONSTRAINT `MergeabilityProjection_sessionRunId_fkey` FOREIGN KEY (`sessionRunId`) REFERENCES `SessionRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExternalIssueSyncCursor` ADD CONSTRAINT `ExternalIssueSyncCursor_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExternalIssueSyncCursor` ADD CONSTRAINT `ExternalIssueSyncCursor_repositoryConnectionId_fkey` FOREIGN KEY (`repositoryConnectionId`) REFERENCES `RepositoryConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEventReceipt` ADD CONSTRAINT `ProviderEventReceipt_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEventReceipt` ADD CONSTRAINT `ProviderEventReceipt_repositoryConnectionId_fkey` FOREIGN KEY (`repositoryConnectionId`) REFERENCES `RepositoryConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProviderEventReceipt` ADD CONSTRAINT `ProviderEventReceipt_externalIssueRefId_fkey` FOREIGN KEY (`externalIssueRefId`) REFERENCES `ExternalIssueRef`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
