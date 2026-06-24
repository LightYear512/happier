# Session-First External Issues: Prisma Schema And Server API Draft

This companion document translates [session-first-external-issues.md](./session-first-external-issues.md)
into a concrete persistence and HTTP control-plane draft.

The companion transaction design lives in
[session-first-external-issues-service-transactions.md](./session-first-external-issues-service-transactions.md).

It is intentionally one step more concrete than the product plan, but it is still
an implementation draft rather than a final migration. The goals are:

- pin the minimum durable Prisma model
- define which invariants live in schema versus service transactions
- sketch the new server-side API surface in Happier's existing route style
- keep naming provider-neutral enough for both GitHub and GitLab

## Scope

This draft assumes the product decisions already made in the main plan:

- external GitHub or GitLab issues remain the planning surface
- Happier stays session-first
- `SessionRun` is the execution control-plane object
- verification is a separate evidence axis, not the main workflow axis
- the default policy is one active primary run per external issue unless a repository policy explicitly enables parallel execution

## Modeling Principles

### Keep new records account-scoped

Happier's server schema is still strongly account-centric. The first landing should
keep every new durable record under `accountId`, even when the row also relates to
`Session`, `Machine`, or `RepositoryConnection`.

### Separate command intent from side effects

Provider mutations such as comments, label sync, or PR or MR updates should not be
fire-and-forget side effects. They should be captured as durable
`ProviderActionRequest` rows and executed through the same lease and retry model as
other control-plane work.

### Store projections, not provider truth

External issue data, verification summaries, and mergeability status should be
treated as cached projections with explicit refresh points. The provider remains the
source of truth for the issue or change itself, but Happier remains the source of
truth for execution state and orchestration decisions.

### Do not overfit Prisma to policy

Some invariants are unconditional and belong in schema constraints. Others depend on
repository policy and should remain transactional service checks until policy
becomes first-class. In particular, "only one active primary run per issue" is a
default scheduling rule, not a universal database invariant.

## Prisma Draft

### Proposed enums

```prisma
enum RepositoryProviderKind {
    github
    gitlab
}

enum RepositoryConnectionMode {
    quickstart
    managed
}

enum RepositoryAuthKind {
    github_app
    gitlab_token
    gh_cli
    glab_cli
    user_pat
}

enum SessionIssueRelation {
    primary
    context
}

enum SessionRunState {
    queued
    claimed
    running
    waiting_user
    succeeded
    failed
    cancelled
    expired
}

enum ProviderActionKind {
    comment
    label_sync
    assignee_sync
    issue_link_back
    open_change
    update_change
    close_issue
}

enum ProviderActionExecutionMode {
    server_worker
    machine_runtime
}

enum ProviderActionState {
    queued
    claimed
    running
    succeeded
    failed
    cancelled
    expired
}

enum VerificationSource {
    remote_ci
    local_runtime
    manual_override
}

enum VerificationLifecycleState {
    queued
    running
    completed
    failed
    cancelled
    timed_out
}

enum VerificationConclusion {
    passed
    failed
    pending
    skipped
    neutral
    action_required
    unknown
}

enum VerificationProjectionHeadline {
    verified_remote
    verified_local_only
    partially_verified
    unverified
    verification_failed
    verification_pending
}

enum VerificationBlockingState {
    clear
    warning
    blocked
}

enum IssueWorkflowState {
    idle
    executing
    change_open
    awaiting_review
    done
}

enum MergeabilityState {
    mergeable
    blocked_required_checks
    blocked_reviews
    blocked_conflicts
    draft
    unknown
}
```

### Relation additions to existing models

The existing `Account`, `Session`, and `Machine` models should gain relation fields
for the new control-plane entities.

```prisma
model Account {
    repositoryConnections      RepositoryConnection[]
    externalIssueRefs          ExternalIssueRef[]
    issueExecutionProjections  IssueExecutionProjection[]
    sessionIssueLinks          SessionIssueLink[]
    sessionRuns                SessionRun[]
    providerActionRequests     ProviderActionRequest[]
    providerEventReceipts      ProviderEventReceipt[]
    externalIssueSyncCursors   ExternalIssueSyncCursor[]
    verificationPolicies       VerificationPolicy[]
    verificationAttempts       VerificationAttempt[]
    verificationProjections    VerificationProjection[]
    mergeabilityProjections    MergeabilityProjection[]
}

model Session {
    issueLinks                 SessionIssueLink[]
    issueRuns                  SessionRun[]
    activeIssueExecutionProjections IssueExecutionProjection[] @relation("IssueExecutionProjectionActivePrimarySession")
}

model Machine {
    claimedIssueRuns           SessionRun[]            @relation("SessionRunClaimedByMachine")
    pollerRepositoryConnections RepositoryConnection[] @relation("RepositoryConnectionPollingOwnerMachine")
    targetedProviderActions    ProviderActionRequest[] @relation("ProviderActionTargetMachine")
}
```

### `RepositoryConnection`

```prisma
model RepositoryConnection {
    id                    String                   @id @default(cuid())
    accountId             String
    account               Account                  @relation(fields: [accountId], references: [id], onDelete: Cascade)
    provider              RepositoryProviderKind
    providerBaseUrl       String
    repositoryKey         String
    mode                  RepositoryConnectionMode
    authKind              RepositoryAuthKind
    enabled               Boolean                  @default(true)
    webhookEnabled        Boolean                  @default(false)
    remoteCiDetected      Boolean                  @default(false)
    pollerEnabled         Boolean                  @default(false)
    pollingOwnerMachineId String?
    pollingOwnerMachine   Machine?                 @relation("RepositoryConnectionPollingOwnerMachine", fields: [pollingOwnerMachineId], references: [id], onDelete: SetNull)
    pollingLeaseExpiresAt DateTime?
    degradedReason        String?
    capabilities          Json?
    installedAt           DateTime?
    lastCapabilitySyncAt  DateTime?
    createdAt             DateTime                 @default(now())
    updatedAt             DateTime                 @updatedAt
    issueRefs             ExternalIssueRef[]
    sessionRuns           SessionRun[]
    providerActions       ProviderActionRequest[]
    eventReceipts         ProviderEventReceipt[]
    verificationPolicies  VerificationPolicy[]
    syncCursors           ExternalIssueSyncCursor[]

    @@unique([accountId, provider, providerBaseUrl, repositoryKey])
    @@index([accountId, enabled, updatedAt(sort: Desc)])
    @@index([accountId, mode, updatedAt(sort: Desc)])
    @@index([pollingOwnerMachineId, pollingLeaseExpiresAt])
}
```

Notes:

- `capabilities` should cache provider and repository facts such as webhook support,
  detected default branch, remote CI presence, and whether required reviews are
  enabled.
- `pollerEnabled` should be true only when Quickstart mode explicitly delegates
  provider polling to a machine or runtime with valid local credentials.

### `ExternalIssueRef`

```prisma
model ExternalIssueRef {
    id                     String                   @id @default(cuid())
    accountId              String
    account                Account                  @relation(fields: [accountId], references: [id], onDelete: Cascade)
    repositoryConnectionId String
    repositoryConnection   RepositoryConnection     @relation(fields: [repositoryConnectionId], references: [id], onDelete: Cascade)
    provider               RepositoryProviderKind
    providerBaseUrl        String
    repositoryKey          String
    providerIssueExternalId String?
    issueNumber            Int
    title                  String
    state                  String
    labels                 Json?
    assignees              Json?
    url                    String
    lastEventKey           String?
    lastEventAt            DateTime?
    rawSnapshot            Json?
    syncedAt               DateTime
    createdAt              DateTime                 @default(now())
    updatedAt              DateTime                 @updatedAt
    sessionLinks           SessionIssueLink[]
    sessionRuns            SessionRun[]
    executionProjection    IssueExecutionProjection?
    providerActions        ProviderActionRequest[]
    providerEventReceipts  ProviderEventReceipt[]

    @@unique([accountId, provider, providerBaseUrl, repositoryKey, issueNumber])
    @@index([repositoryConnectionId, issueNumber])
    @@index([accountId, state, syncedAt(sort: Desc)])
    @@index([accountId, repositoryKey, updatedAt(sort: Desc)])
}
```

Notes:

- `rawSnapshot` should be a compact provider projection rather than a complete webhook payload dump.
- `lastEventKey` is only a convenience hint for troubleshooting and incremental
  refresh. Canonical webhook and poll idempotency should live in a durable event
  receipt table rather than in the issue projection row itself.

### `SessionIssueLink`

```prisma
model SessionIssueLink {
    id                 String               @id @default(cuid())
    accountId          String
    account            Account              @relation(fields: [accountId], references: [id], onDelete: Cascade)
    sessionId          String
    session            Session              @relation(fields: [sessionId], references: [id], onDelete: Cascade)
    externalIssueRefId String
    externalIssueRef   ExternalIssueRef     @relation(fields: [externalIssueRefId], references: [id], onDelete: Cascade)
    relation           SessionIssueRelation
    active             Boolean              @default(true)
    resolutionReason   String?
    createdBy          String?
    createdAt          DateTime             @default(now())
    updatedAt          DateTime             @updatedAt
    deactivatedAt      DateTime?

    @@index([externalIssueRefId, relation, active])
    @@index([sessionId, relation, active])
    @@index([sessionId, externalIssueRefId, relation, active])
    @@index([accountId, createdAt(sort: Desc)])
}
```

Notes:

- Keep `createdBy` as a string in the first landing. It can encode values such as
  `user`, `automation`, `webhook`, or `poller` without prematurely introducing a
  polymorphic actor model.
- Do not make `(sessionId, externalIssueRefId, relation)` globally unique if link
  history matters. Otherwise a deactivated primary link can never be recreated for
  the same session and issue pair after reassignment or archival.
- The stronger "only one active primary link for an open issue" rule should remain
  a service-layer transactional invariant for now. Prisma cannot express the needed
  policy-aware partial uniqueness cleanly.

### `SessionRun`

```prisma
model SessionRun {
    id                     String                @id @default(cuid())
    accountId              String
    account                Account               @relation(fields: [accountId], references: [id], onDelete: Cascade)
    repositoryConnectionId String
    repositoryConnection   RepositoryConnection  @relation(fields: [repositoryConnectionId], references: [id], onDelete: Cascade)
    sessionId              String
    session                Session               @relation(fields: [sessionId], references: [id], onDelete: Cascade)
    externalIssueRefId     String
    externalIssueRef       ExternalIssueRef      @relation(fields: [externalIssueRefId], references: [id], onDelete: Cascade)
    state                  SessionRunState       @default(queued)
    triggerKind            String
    scheduledAt            DateTime              @default(now())
    dueAt                  DateTime?
    claimedAt              DateTime?
    startedAt              DateTime?
    finishedAt             DateTime?
    claimedByMachineId     String?
    claimedByMachine       Machine?              @relation("SessionRunClaimedByMachine", fields: [claimedByMachineId], references: [id], onDelete: SetNull)
    leaseExpiresAt         DateTime?
    attempt                Int                   @default(0)
    idempotencyKey         String
    generation            Int
    branchName             String?
    providerChangeUrl      String?
    providerChangeNumber   Int?
    providerChangeExternalId String?
    headCommitSha          String?
    baseCommitSha          String?
    errorCode              String?
    errorMessage           String?
    retryOfRunId           String?
    retryOfRun             SessionRun?           @relation("SessionRunRetryChain", fields: [retryOfRunId], references: [id], onDelete: SetNull)
    retryChildren          SessionRun[]          @relation("SessionRunRetryChain")
    createdAt              DateTime              @default(now())
    updatedAt              DateTime              @updatedAt
    events                 SessionRunEvent[]
    providerActions        ProviderActionRequest[]
    activeIssueExecutionProjections IssueExecutionProjection[] @relation("IssueExecutionProjectionActivePrimaryRun")
    verificationAttempts   VerificationAttempt[]
    verificationProjection VerificationProjection?
    mergeabilityProjection MergeabilityProjection?

    @@unique([accountId, idempotencyKey])
    @@index([accountId, state, scheduledAt(sort: Desc)])
    @@index([sessionId, createdAt(sort: Desc)])
    @@index([externalIssueRefId, createdAt(sort: Desc)])
    @@index([claimedByMachineId, leaseExpiresAt])
    @@index([providerChangeExternalId, headCommitSha])
}
```

Notes:

- `generation` is the late-result barrier. Any state transition coming from a stale
  machine lease, stale verification result, or stale mergeability refresh must
  compare against the current run generation and head SHA before mutating
  projections.
- `triggerKind` should remain a string in the first landing. The product will
  likely add more trigger causes than are worth freezing in the initial schema.
- If the product later supports repository-policy-driven parallel execution, that
  policy should be evaluated in service transactions before a second active run is
  created for the same issue.

### `IssueExecutionProjection`

```prisma
model IssueExecutionProjection {
    id                         String              @id @default(cuid())
    accountId                  String
    account                    Account             @relation(fields: [accountId], references: [id], onDelete: Cascade)
    externalIssueRefId         String              @unique
    externalIssueRef           ExternalIssueRef    @relation(fields: [externalIssueRefId], references: [id], onDelete: Cascade)
    workflowState              IssueWorkflowState
    activePrimarySessionId     String?
    activePrimarySession       Session?            @relation("IssueExecutionProjectionActivePrimarySession", fields: [activePrimarySessionId], references: [id], onDelete: SetNull)
    activePrimaryRunId         String?
    activePrimaryRun           SessionRun?         @relation("IssueExecutionProjectionActivePrimaryRun", fields: [activePrimaryRunId], references: [id], onDelete: SetNull)
    currentProviderChangeExternalId String?
    currentProviderChangeUrl   String?
    subjectHeadSha             String?
    transitionReason           String?
    updatedAt                  DateTime            @updatedAt

    @@index([accountId, workflowState, updatedAt(sort: Desc)])
    @@index([activePrimarySessionId])
    @@index([activePrimaryRunId])
}
```

Notes:

- This is the read model for the main workflow axis from the primary design doc.
- It prevents the UI from having to infer `idle`, `executing`, `change_open`,
  `awaiting_review`, or `done` by reimplementing server orchestration rules.
- The projection should move forward only inside the same transactional services
  that create, retry, complete, or close runs.

### `SessionRunEvent`

```prisma
model SessionRunEvent {
    id           String      @id @default(cuid())
    sessionRunId String
    sessionRun   SessionRun  @relation(fields: [sessionRunId], references: [id], onDelete: Cascade)
    ts           DateTime    @default(now())
    type         String
    payload      Json?

    @@index([sessionRunId, ts])
    @@index([ts])
}
```

### `ProviderActionRequest`

```prisma
model ProviderActionRequest {
    id                     String                       @id @default(cuid())
    accountId              String
    account                Account                      @relation(fields: [accountId], references: [id], onDelete: Cascade)
    repositoryConnectionId String
    repositoryConnection   RepositoryConnection         @relation(fields: [repositoryConnectionId], references: [id], onDelete: Cascade)
    sessionRunId           String?
    sessionRun             SessionRun?                  @relation(fields: [sessionRunId], references: [id], onDelete: SetNull)
    externalIssueRefId     String?
    externalIssueRef       ExternalIssueRef?            @relation(fields: [externalIssueRefId], references: [id], onDelete: SetNull)
    provider               RepositoryProviderKind
    repositoryKey          String
    actionKind             ProviderActionKind
    executionMode          ProviderActionExecutionMode
    state                  ProviderActionState          @default(queued)
    targetMachineId        String?
    targetMachine          Machine?                     @relation("ProviderActionTargetMachine", fields: [targetMachineId], references: [id], onDelete: SetNull)
    idempotencyKey         String
    claimedByExecutorId    String?
    claimedAt              DateTime?
    startedAt              DateTime?
    finishedAt             DateTime?
    leaseExpiresAt         DateTime?
    payload                Json
    attemptCount           Int                          @default(0)
    lastErrorCode          String?
    lastErrorMessage       String?
    lastAttemptedAt        DateTime?
    createdAt              DateTime                     @default(now())
    updatedAt              DateTime                     @updatedAt

    @@unique([accountId, idempotencyKey])
    @@index([accountId, state, createdAt(sort: Desc)])
    @@index([repositoryConnectionId, state, createdAt(sort: Desc)])
    @@index([targetMachineId, leaseExpiresAt])
    @@index([sessionRunId, state, createdAt(sort: Desc)])
}
```

Notes:

- `claimedByExecutorId` intentionally stays polymorphic. In managed mode it will
  usually be a worker identifier; in Quickstart mode it may be a machine id.
- `claimedAt`, `startedAt`, and `finishedAt` give provider writeback operations the
  same minimum observability as `AutomationRun` and `SessionRun`.
- `payload` should be a provider-neutral command envelope. Example fields:
  `kind`, `issueNumber`, `changeExternalId`, `commentBody`, `labelSet`,
  `branchName`, `headSha`, and `retryGeneration`.

### Verification models

```prisma
model VerificationPolicy {
    id                       String                  @id @default(cuid())
    accountId                String
    account                  Account                 @relation(fields: [accountId], references: [id], onDelete: Cascade)
    repositoryConnectionId   String
    repositoryConnection     RepositoryConnection    @relation(fields: [repositoryConnectionId], references: [id], onDelete: Cascade)
    repositoryKey            String
    requiresRemoteCi         Boolean                 @default(false)
    allowsLocalVerifyFallback Boolean                @default(true)
    autoMergeEligible        Boolean                 @default(false)
    blockingSuites           Json?
    localVerifyCommands      Json?
    createdAt                DateTime                @default(now())
    updatedAt                DateTime                @updatedAt

    @@unique([repositoryConnectionId])
    @@index([accountId, repositoryKey])
}

model VerificationAttempt {
    id                   String                     @id @default(cuid())
    accountId            String
    account              Account                    @relation(fields: [accountId], references: [id], onDelete: Cascade)
    sessionRunId         String
    sessionRun           SessionRun                 @relation(fields: [sessionRunId], references: [id], onDelete: Cascade)
    source               VerificationSource
    lifecycleState       VerificationLifecycleState
    startedAt            DateTime?
    finishedAt           DateTime?
    summary              String?
    rawExternalId        String?
    providerRunId        String?
    subjectHeadSha       String?
    createdAt            DateTime                   @default(now())
    updatedAt            DateTime                   @updatedAt
    suiteResults         VerificationSuiteResult[]

    @@index([sessionRunId, createdAt(sort: Desc)])
    @@index([accountId, providerRunId])
    @@index([accountId, subjectHeadSha])
}

model VerificationSuiteResult {
    id                   String                   @id @default(cuid())
    verificationAttemptId String
    verificationAttempt  VerificationAttempt      @relation(fields: [verificationAttemptId], references: [id], onDelete: Cascade)
    suiteKey             String
    conclusion           VerificationConclusion
    durationMs           Int?
    artifactUrl          String?
    summary              String?

    @@unique([verificationAttemptId, suiteKey])
    @@index([suiteKey, conclusion])
}

model VerificationProjection {
    id                   String                        @id @default(cuid())
    accountId            String
    account              Account                       @relation(fields: [accountId], references: [id], onDelete: Cascade)
    sessionRunId         String                        @unique
    sessionRun           SessionRun                    @relation(fields: [sessionRunId], references: [id], onDelete: Cascade)
    headline             VerificationProjectionHeadline
    blockingState        VerificationBlockingState
    subjectHeadSha       String?
    suiteSummary         Json?
    updatedAt            DateTime                      @updatedAt

    @@index([accountId, headline, updatedAt(sort: Desc)])
}

model MergeabilityProjection {
    id                        String              @id @default(cuid())
    accountId                 String
    account                   Account             @relation(fields: [accountId], references: [id], onDelete: Cascade)
    sessionRunId              String              @unique
    sessionRun                SessionRun          @relation(fields: [sessionRunId], references: [id], onDelete: Cascade)
    mergeabilityState         MergeabilityState
    requiredChecksOutstanding Int                 @default(0)
    requiredReviewsRemaining  Int                 @default(0)
    subjectHeadSha            String?
    rawProjection             Json?
    updatedAt                 DateTime            @updatedAt

    @@index([accountId, mergeabilityState, updatedAt(sort: Desc)])
}
```

Notes:

- `subjectHeadSha` is mandatory for stale-result rejection even if a provider does
  not offer stable run ids for every CI or mergeability refresh.
- `suiteSummary` and `rawProjection` should stay compact. The authoritative raw CI
  logs belong in provider artifacts rather than the core control-plane database.

### `ExternalIssueSyncCursor`

```prisma
model ExternalIssueSyncCursor {
    id                     String                 @id @default(cuid())
    accountId              String
    account                Account                @relation(fields: [accountId], references: [id], onDelete: Cascade)
    repositoryConnectionId String
    repositoryConnection   RepositoryConnection   @relation(fields: [repositoryConnectionId], references: [id], onDelete: Cascade)
    cursorKind             String
    cursorValue            String
    observedAt             DateTime               @default(now())
    updatedAt              DateTime               @updatedAt

    @@unique([repositoryConnectionId, cursorKind])
    @@index([accountId, observedAt(sort: Desc)])
    @@index([observedAt])
}
```

This model is optional in managed webhook mode, but it becomes important in
Quickstart polling mode for issue cursors, change cursors, and remote CI cursors.

### `ProviderEventReceipt`

```prisma
model ProviderEventReceipt {
    id                     String                 @id @default(cuid())
    accountId              String
    account                Account                @relation(fields: [accountId], references: [id], onDelete: Cascade)
    repositoryConnectionId String
    repositoryConnection   RepositoryConnection   @relation(fields: [repositoryConnectionId], references: [id], onDelete: Cascade)
    externalIssueRefId     String?
    externalIssueRef       ExternalIssueRef?      @relation(fields: [externalIssueRefId], references: [id], onDelete: SetNull)
    provider               RepositoryProviderKind
    receiptKey             String
    eventKind              String
    firstSeenAt            DateTime               @default(now())
    updatedAt              DateTime               @updatedAt

    @@unique([repositoryConnectionId, receiptKey])
    @@index([accountId, firstSeenAt(sort: Desc)])
}
```

This inbox table gives webhook and poll processing a durable dedupe point. It
should be written before any run enqueue decision is made. For managed webhooks,
`receiptKey` should be derived from the provider delivery id plus a normalized
event discriminator. For Quickstart polling, it should usually be the normalized
`eventKey`.

## Schema Invariants That Stay In Services

The first implementation should keep these checks inside transactional service
logic rather than forcing them into awkward schema constraints:

- only one active primary run per external issue by default
- only one active primary issue per execution session by default
- comment-triggered reruns coalesce into a queued follow-up instead of opening a competing run
- repository policy may explicitly allow parallel execution later
- retry must increment `generation` and carry forward the provider change identity rather than cloning stale projections

If the policy model later hardens, some of these can move into partial unique
indexes implemented in SQL migrations rather than Prisma schema syntax.

## Server-Side API Draft

### Route ownership

Recommended landing points in `apps/server/sources/app/api/routes/`:

- `repositories/registerRepositoryConnectionRoutes.ts`
- `externalIssues/registerExternalIssueRoutes.ts`
- `sessionRuns/registerSessionRunRoutes.ts`
- `sessionRuns/registerSessionRunDaemonRoutes.ts`
- `providerActions/registerProviderActionDaemonRoutes.ts`
- `integrations/registerProviderWebhookRoutes.ts`

Recommended service landing points:

- `apps/server/sources/app/repositories/`
- `apps/server/sources/app/externalIssues/`
- `apps/server/sources/app/sessionRuns/`
- `apps/server/sources/app/providerActions/`
- `apps/server/sources/app/verification/`
- `apps/server/sources/app/integrations/`

### API principles

- Use `/v2` for the new account-scoped control-plane surface.
- Keep provider webhooks as dedicated server endpoints with signature validation, not Bearer auth.
- Keep machine-executed claim and heartbeat endpoints separate from user-facing list and mutation endpoints.
- Embed the latest verification and mergeability projections into `SessionRun` detail responses so the UI can render one coherent execution card.
- Treat every mutation as idempotent. Callers may retry after timeouts.

### Repository connection routes

#### `GET /v2/repositories/connections`

List repository connections visible to the account.

Query filters:

- `provider`
- `mode`
- `enabled`
- `repositoryKey`

Response shape:

```json
{
  "connections": [
    {
      "id": "rc_123",
      "provider": "github",
      "providerBaseUrl": "https://github.com",
      "repositoryKey": "owner/repo",
      "mode": "managed",
      "authKind": "github_app",
      "enabled": true,
      "webhookEnabled": true,
      "remoteCiDetected": true,
      "pollerEnabled": false,
      "pollingOwnerMachineId": null,
      "pollingLeaseExpiresAt": null,
      "degradedReason": null,
      "capabilities": {},
      "installedAt": 1760000000000,
      "lastCapabilitySyncAt": 1760000000000,
      "updatedAt": 1760000000000
    }
  ]
}
```

#### `POST /v2/repositories/connections`

Create or upsert a repository connection.

Body:

- `provider`
- `providerBaseUrl`
- `repositoryKey`
- `mode`
- `authKind`
- optional `pollerEnabled`
- optional `pollingOwnerMachineId`

Behavior:

- in managed mode, validates that the account has the required connected identity or install metadata
- in Quickstart mode, validates that the chosen machine is known to the account before assigning polling ownership
- returns the upserted connection plus any degraded-mode warnings

#### `GET /v2/repositories/connections/:connectionId`

Return the connection plus lightweight counters:

- open issue count
- active run count
- last successful poll or webhook timestamp
- current verification policy

#### `POST /v2/repositories/connections/:connectionId/refresh`

Force a capability refresh.

Typical uses:

- rescan webhook health
- rescan remote CI presence
- rescan default branch and merge policy

#### `GET /v2/repositories/connections/:connectionId/verification-policy`

Return the repository's current verification policy projection.

#### `POST /v2/repositories/connections/:connectionId/verification-policy`

Create or update the repository verification policy.

Body:

- `requiresRemoteCi`
- `allowsLocalVerifyFallback`
- `autoMergeEligible`
- optional `blockingSuites`
- optional `localVerifyCommands`

Behavior:

- upserts the `VerificationPolicy`
- validates command payload shape before persistence
- returns the stored policy plus an effective-capability summary

#### `POST /v2/repositories/connections/:connectionId/poller/claim`

Quickstart-only route for a machine to claim the repository poll lease.

Body:

- `machineId`
- optional `leaseDurationMs`

Response:

- `ok`
- `leaseExpiresAt`
- `connection`

#### `POST /v2/repositories/connections/:connectionId/poller/heartbeat`

Refresh the active poll lease.

Body:

- `machineId`
- optional `leaseDurationMs`
- optional `capabilities`

Behavior:

- returns `409 poller_lease_lost` if another machine already owns the active lease
- lets the active poller update detected capabilities opportunistically

#### `POST /v2/repositories/connections/:connectionId/events/push`

Quickstart pollers do not call provider write APIs directly into the control plane.
They first normalize provider observations and push them to the server through this route.

Body:

- `machineId`
- `events[]`

Each normalized event should include:

- `eventKey`
- `occurredAt`
- `kind`
- `issueNumber`
- optional `providerChangeExternalId`
- optional `headCommitSha`
- optional `command`
- optional `snapshot`

The server verifies that the authenticated machine still owns the repository poll
lease, dedupes by `eventKey`, updates projections, and decides whether to enqueue
or coalesce a `SessionRun`.

Duplicate pushes should return `200` with a no-op or `deduped` marker rather than a
transport-level error so pollers can retry safely.

### External issue routes

#### `GET /v2/external-issues`

List issue projections known to the account.

Query filters:

- `repositoryConnectionId`
- `state`
- `label`
- `linkedSessionId`
- `activeRunState`
- `cursor`
- `limit`

#### `POST /v2/external-issues/resolve`

Resolve a pasted provider URL or `(provider, repositoryKey, issueNumber)` tuple into
an `ExternalIssueRef`. The server upserts the projection if it does not already exist.

Body:

- optional `url`
- optional `provider`
- optional `providerBaseUrl`
- optional `repositoryKey`
- optional `issueNumber`

#### `GET /v2/external-issues/:issueRefId`

Return one issue projection plus:

- current primary session link if any
- current `IssueExecutionProjection`
- active and recent runs
- latest verification headline
- latest mergeability state for the current provider change

#### `POST /v2/external-issues/:issueRefId/launch`

Manual launch entrypoint for session-first execution.

Body:

- optional `sessionId`
- optional `machineId`
- optional `forceNewSession`
- optional `comment`
- `idempotencyKey`

Behavior:

- runs the same eligibility and session-resolution logic as automation
- reuses the active primary run when policy says attach instead of fork
- returns either the active run or the newly queued run

### Session run routes

#### `GET /v2/session-runs`

List runs for a user-visible dashboard or issue detail surface.

Query filters:

- `sessionId`
- `externalIssueRefId`
- `repositoryConnectionId`
- `state`
- `cursor`
- `limit`

#### `GET /v2/session-runs/:runId`

Return the control-plane view for one run.

Recommended response fields:

- run core fields
- linked `session`
- linked `externalIssueRef`
- current `verificationProjection`
- current `mergeabilityProjection`
- latest provider change metadata
- recent `SessionRunEvent[]`

#### `POST /v2/session-runs/:runId/retry`

Queue a retry or repair run.

Body:

- optional `machineId`
- optional `reason`
- `idempotencyKey`

Behavior:

- increments `generation`
- reuses existing branch and provider change identity when possible
- does not create a competing active primary run

#### `POST /v2/session-runs/:runId/abort`

Request terminal cancellation.

Behavior:

- active machine loses the lease on next heartbeat or explicit cancellation handoff
- queued follow-up runs for the same issue may be dropped or left pending based on policy

### Session run daemon routes

These routes should mirror the proven automation patterns already present under
`/v2/automations/runs/*`.

#### `POST /v2/session-runs/claim`

Body:

- `machineId`
- optional `leaseDurationMs`

Response:

- `run`
- `session`
- `externalIssue`
- `repositoryConnection`
- current `verificationPolicy`

#### `POST /v2/session-runs/:runId/heartbeat`

Body:

- `machineId`
- `generation`
- optional `leaseDurationMs`
- optional `headCommitSha`

Response:

- `ok`
- `leaseExpiresAt`
- optional `serverDirective`

Example directives:

- `continue`
- `abort`
- `wait_user`
- `enqueue_provider_action`

#### `POST /v2/session-runs/:runId/start`

Body:

- `machineId`
- `generation`
- optional `headCommitSha`
- optional `branchName`

#### `POST /v2/session-runs/:runId/wait-user`

Body:

- `machineId`
- `generation`
- `reasonCode`
- optional `reasonMessage`

Use when the runtime is blocked on missing credentials, a provider permission
problem, or a human decision that should not be treated as an infrastructure failure.

#### `POST /v2/session-runs/:runId/succeed`

Body:

- `machineId`
- `generation`
- optional `branchName`
- optional `providerChangeUrl`
- optional `providerChangeNumber`
- optional `providerChangeExternalId`
- optional `headCommitSha`
- optional `baseCommitSha`
- optional `summaryCiphertext`

Behavior:

- closes the run execution state
- does not automatically mark the workflow `done`
- may enqueue provider writeback actions or verification aggregation refreshes

#### `POST /v2/session-runs/:runId/fail`

Body:

- `machineId`
- `generation`
- optional `errorCode`
- optional `errorMessage`
- optional `headCommitSha`
- optional `retryRecommended`

### Provider action daemon routes

These routes are only needed if provider writebacks are executed through the same
machine that owns CLI credentials or branch context.

#### `POST /v2/provider-actions/claim`

Body:

- `machineId`
- optional `leaseDurationMs`

Response:

- `action`
- optional `repositoryConnection`

#### `POST /v2/provider-actions/:actionId/heartbeat`

Body:

- `machineId`
- optional `leaseDurationMs`

#### `POST /v2/provider-actions/:actionId/start`

Body:

- `machineId`

#### `POST /v2/provider-actions/:actionId/succeed`

Body:

- `machineId`
- optional `providerExternalId`
- optional `summary`

#### `POST /v2/provider-actions/:actionId/fail`

Body:

- `machineId`
- optional `errorCode`
- optional `errorMessage`
- optional `retryRecommended`

### Provider webhook routes

Managed mode should own dedicated webhook endpoints per provider.

#### `POST /v1/integrations/github/webhook`

- validates GitHub signature and delivery id
- normalizes issue, comment, provider change, and CI events
- emits internal `ExternalIssueEvent` records into the control plane

#### `POST /v1/integrations/gitlab/webhook`

- validates GitLab secret
- normalizes issue, note, merge request, and pipeline events
- emits internal `ExternalIssueEvent` records into the control plane

These routes should be thin adapters. Normalization, dedupe, and orchestration
belong in service modules rather than in the Fastify handler bodies.

## DTO And Error Draft

### `SessionRunDto`

The UI and CLI should not need to stitch together half a dozen read models to show
run state. A practical draft is:

```json
{
  "run": {
    "id": "sr_123",
    "state": "running",
    "triggerKind": "manual_launch",
    "attempt": 1,
    "generation": 3,
    "branchName": "happier/issue-123",
    "providerChangeUrl": "https://github.com/owner/repo/pull/12",
    "headCommitSha": "abc123",
    "leaseExpiresAt": 1760000000000,
    "createdAt": 1760000000000,
    "updatedAt": 1760000000000
  },
  "workflow": {
    "state": "change_open",
    "currentProviderChangeUrl": "https://github.com/owner/repo/pull/12",
    "subjectHeadSha": "abc123"
  },
  "session": {
    "id": "sess_123",
    "title": "Issue 123"
  },
  "externalIssue": {
    "id": "eir_123",
    "provider": "github",
    "repositoryKey": "owner/repo",
    "issueNumber": 123,
    "title": "Broken test"
  },
  "verification": {
    "headline": "verified_local_only",
    "blockingState": "warning",
    "subjectHeadSha": "abc123",
    "suiteSummary": {}
  },
  "mergeability": {
    "mergeabilityState": "blocked_required_checks",
    "requiredChecksOutstanding": 2,
    "requiredReviewsRemaining": 1,
    "subjectHeadSha": "abc123"
  },
  "events": []
}
```

### Error codes

Suggested stable errors for the first landing:

- `repository_connection_not_found`
- `external_issue_not_found`
- `session_run_not_found`
- `session_run_not_claimed`
- `session_run_generation_conflict`
- `session_run_already_active`
- `session_resolution_conflict`
- `poller_lease_lost`
- `provider_action_not_found`
- `provider_action_not_claimed`
- `provider_webhook_signature_invalid`
- `repository_connection_degraded`

## Transaction Boundaries

The control plane should center the following transactional operations:

- `recordProviderEventReceipt`
  - verify repository connection and provider
  - insert or load the durable delivery receipt
  - short-circuit duplicate deliveries before projection updates

- `upsertExternalIssueProjection`
  - apply normalized event
  - update `ExternalIssueRef`
  - update `IssueExecutionProjection` when the workflow axis moves
  - decide whether to enqueue a run

- `launchOrAttachSessionRun`
  - verify eligibility
  - resolve or create target session
  - check active-run invariant
  - create `SessionRun`
  - create or refresh the primary `SessionIssueLink`

- `claimSessionRun`
  - claim oldest eligible queued run for the machine
  - set lease
  - append event

- `completeSessionRun`
  - compare machine lease ownership
  - compare `generation`
  - update run state
  - append event
  - optionally enqueue provider actions and verification aggregation work

- `applyVerificationUpdate`
  - upsert `VerificationAttempt`
  - reject stale `subjectHeadSha`
  - recalculate `VerificationProjection`

- `applyMergeabilityUpdate`
  - reject stale `subjectHeadSha`
  - update `MergeabilityProjection`

## First Vertical Slice

The lowest-risk first landing for code should implement only this subset:

- GitHub managed mode
- `RepositoryConnection`
- `ExternalIssueRef`
- `SessionIssueLink`
- `SessionRun`
- `ProviderActionRequest`
- manual launch and webhook-driven launch
- new session creation only
- one active primary run per issue
- local verification only
- provider change creation plus summary comment writeback

That slice is narrow enough to ship incrementally, but it already validates the
core schema and API surface proposed here.
