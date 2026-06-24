# Session-First External Issues: Service Transaction Design

This document turns the transaction boundary list from
[session-first-external-issues-schema-api.md](./session-first-external-issues-schema-api.md)
into a concrete service-layer design aligned with Happier's existing server
patterns.

It assumes:

- the product decisions from [session-first-external-issues.md](./session-first-external-issues.md)
- the durable models from [session-first-external-issues-schema-api.md](./session-first-external-issues-schema-api.md)
- Happier server transactions continue to use `inTx()` and `afterTx()` from
  [`apps/server/sources/storage/inTx.ts`](</Users/ab/workspace/happier/apps/server/sources/storage/inTx.ts>)

## Goals

- define the canonical transactional service surface before route handlers exist
- make idempotency and late-result rejection part of the service contract, not UI convention
- keep provider side effects out of DB transactions
- preserve Happier's existing pattern: transactional writes first, socket fanout and background work through `afterTx`

## Design Constraints From Existing Happier Server

### Serializable transactions with automatic retry

Happier already wraps write services in `inTx()`, which:

- uses `Serializable` isolation on Postgres
- retries retryable transaction failures
- runs `afterTx()` callbacks only after commit

That means the new orchestration services should be written assuming:

- transient serialization failures are normal
- transaction bodies must be deterministic and safe to retry
- socket fanout, async orchestration wakeups, and provider side effects must not happen inline in the transaction body

### `afterTx()` is the only safe place for fanout

The existing server rule is explicit: do not emit socket updates from inside the
DB transaction. New issue-execution services should follow the same contract:

- transaction body mutates durable state
- `afterTx()` notifies the event router
- workers or background loops react after commit

### Account-scoped ownership checks happen inside transactions

Every transaction that mutates issue-execution state should validate `accountId`
ownership inside the transaction itself. Do not assume the route layer already
proved enough.

## Recommended Service Modules

Recommended server modules:

- `apps/server/sources/app/integrations/providerEventService.ts`
- `apps/server/sources/app/externalIssues/externalIssueProjectionService.ts`
- `apps/server/sources/app/sessionRuns/sessionRunLaunchService.ts`
- `apps/server/sources/app/sessionRuns/sessionRunClaimService.ts`
- `apps/server/sources/app/sessionRuns/sessionRunLifecycleService.ts`
- `apps/server/sources/app/providerActions/providerActionService.ts`
- `apps/server/sources/app/verification/verificationProjectionService.ts`
- `apps/server/sources/app/repositories/repositoryPollingService.ts`

The first implementation does not need all of these as separate files, but the
service boundaries should stay recognizable.

## Repository Management Transactions

These transactions are not on the hot execution path, but they still need clear
ownership because they define repository capabilities and policy.

## `upsertRepositoryConnection`

### Purpose

Create or update the account-scoped repository integration projection.

### Caller

- `POST /v2/repositories/connections`

### Writes

- create or update `RepositoryConnection`
- preserve existing poll lease ownership unless the request explicitly reassigns it
- normalize provider base URL and repository key before persistence

### `afterTx()`

- emit account-scoped connection update

## `refreshRepositoryConnectionCapabilities`

### Purpose

Refresh cached provider capabilities without changing issue execution state.

### Caller

- `POST /v2/repositories/connections/:connectionId/refresh`
- poller heartbeat when capability snapshots changed

### Writes

- update `RepositoryConnection.capabilities`
- update `remoteCiDetected`
- update `lastCapabilitySyncAt`
- optionally set or clear `degradedReason`

## `upsertVerificationPolicy`

### Purpose

Persist repository-level evidence policy that later transactions can read without
route-local branching.

### Caller

- `POST /v2/repositories/connections/:connectionId/verification-policy`

### Writes

- upsert `VerificationPolicy`
- validate and normalize `blockingSuites`
- validate and normalize `localVerifyCommands`

### `afterTx()`

- emit account-scoped repository policy update

## `resolveExternalIssueRef`

### Purpose

Resolve a provider URL or `(provider, repositoryKey, issueNumber)` tuple into a
durable `ExternalIssueRef` without launching execution by itself.

### Caller

- `POST /v2/external-issues/resolve`

### Execution shape

Use a two-step flow:

1. fetch the authoritative issue snapshot from the provider outside the transaction
2. in a short transaction, upsert `ExternalIssueRef` and any missing `IssueExecutionProjection`

### Writes

- create or update `ExternalIssueRef`
- create `IssueExecutionProjection` with `workflowState = idle` when absent

### Does not do

- does not enqueue a run
- does not create a session
- does not create a receipt row unless the resolve flow is backed by a real provider delivery

## Shared Transaction Contract

Every orchestration transaction should answer the same questions.

### Inputs

- actor scope: `accountId`, plus `machineId` when machine-owned
- target scope: `repositoryConnectionId`, `externalIssueRefId`, `sessionId`, or `sessionRunId`
- idempotency material: `idempotencyKey`, `receiptKey`, or `(subjectHeadSha, generation)`
- mutation intent: launch, claim, heartbeat, complete, retry, verify, write back

### Reads

Prefer a stable order for hot transactions:

1. account-scoped owner row
2. repository connection
3. external issue
4. primary workflow projection
5. current active run or action

This reduces the chance of deadlock when multiple workers touch the same issue.

### Writes

Each transaction should mutate only the rows needed for its invariant:

- one primary control-plane object
- one projection row if the workflow axis changes
- one event row if the operation is meaningful to the audit trail
- one receipt or idempotency row when dedupe matters

### `afterTx()` side effects

Allowed `afterTx()` actions:

- emit account or session-scoped socket updates
- enqueue in-memory worker wakeups
- schedule async provider action executors

Disallowed inside the transaction:

- calling GitHub or GitLab
- invoking `gh` or `glab`
- long-running verification
- sleeping or polling

## Concurrency Rules

### Per-issue primary execution

Default policy remains:

- one active primary run per external issue
- one active primary issue per execution session

This is not enforced by a single Prisma constraint, so every launch and retry
transaction must check it explicitly.

### Generation barrier

`SessionRun.generation` is the stale-result barrier.

Any transaction that completes a run or applies provider feedback to a run must
verify:

- the target run is still current for the issue
- the reported generation matches the run generation
- the `subjectHeadSha` or `headCommitSha` is not older than the current projection

### Provider event receipt before enqueue

Webhook and poll-derived events must record or load a `ProviderEventReceipt`
before making enqueue decisions. Duplicate receipts should return the current
projection or a `deduped` outcome, not raise a user-visible failure.

## Transaction Catalog

Each section below defines one canonical transaction boundary.

## `recordProviderEventReceipt`

### Purpose

Durably dedupe a provider delivery before any projection or scheduling logic runs.

### Caller

- managed webhook handler
- Quickstart poll event push handler

### Inputs

- `accountId`
- `repositoryConnectionId`
- `provider`
- `receiptKey`
- `eventKind`
- optional `externalIssueRefId`

### Reads

- `RepositoryConnection` by `accountId + id`
- existing `ProviderEventReceipt` by `repositoryConnectionId + receiptKey`

### Writes

- create `ProviderEventReceipt` if absent
- otherwise update its `updatedAt` only if the implementation wants touch semantics

### Return

- `{ kind: "new", receipt }`
- `{ kind: "duplicate", receipt }`

### Failure behavior

- `repository_connection_not_found` if the connection is not account-visible
- duplicates are not errors

### `afterTx()`

None.

## `upsertExternalIssueProjection`

### Purpose

Apply one normalized external issue event to the cached issue projection and move
the workflow axis when needed.

### Caller

- provider event service after a new receipt is recorded

### Inputs

- `accountId`
- normalized event
- optional previously matched `externalIssueRefId`

### Reads

- `RepositoryConnection`
- `ExternalIssueRef` by provider identity
- current `IssueExecutionProjection`
- optional active `SessionRun` if the event references a provider change or CI head

### Writes

- create or update `ExternalIssueRef`
- create or update `IssueExecutionProjection`
- append optional `SessionRunEvent` when the event materially changes current execution context

### Workflow transitions owned here

- `idle -> executing` only when the event handler also decides to enqueue a new run
- `executing -> change_open` when a provider change becomes known for the primary run
- `change_open -> awaiting_review` when the primary run has succeeded and the issue now has a reviewable provider change
- `awaiting_review -> done` only when provider merge or close semantics say the work item is complete

### Does not do

- does not call provider APIs
- does not directly create a second active run when one already exists

### `afterTx()`

- emit account-scoped update for issue list or run surfaces
- wake worker loop if the event implies a new launch decision must be evaluated

## `launchOrAttachSessionRun`

### Purpose

Manual launch or automation-triggered launch entrypoint. This is the main control
plane transaction.

### Caller

- `POST /v2/external-issues/:issueRefId/launch`
- webhook or poll-driven automation evaluator
- retry flow when it needs a fresh run row

### Inputs

- `accountId`
- `externalIssueRefId`
- optional requested `sessionId`
- optional preferred `machineId`
- `idempotencyKey`
- `triggerKind`
- launch policy hints such as `forceNewSession`

### Reads

- `ExternalIssueRef`
- `IssueExecutionProjection`
- active primary `SessionIssueLink`
- active `SessionRun` rows for the issue
- current session candidate rows when reusing a session is allowed

### Service decisions inside the transaction

1. Check whether the same `idempotencyKey` already produced a run for the account.
2. If an active primary run already exists for the issue:
   - return it when attach semantics apply
   - otherwise enqueue a follow-up only if policy explicitly allows it
3. Resolve the target session:
   - existing primary session
   - eligible reusable session
   - otherwise create a new session in the same transaction when the route chose `new_session`
4. Verify that the chosen session does not already have a conflicting active primary issue.

### Writes

- optional new `Session`
- create or refresh primary `SessionIssueLink`
- create `SessionRun`
- create `SessionRunEvent(type="queued")`
- update `IssueExecutionProjection`
  - `workflowState = executing`
  - `activePrimarySessionId = target session`
  - `activePrimaryRunId = new run`
  - `transitionReason = triggerKind`

### Idempotency

- primary key: `SessionRun(accountId, idempotencyKey)`
- if the key already exists, return the existing run and skip duplicate writes

### `afterTx()`

- emit session and account-scoped update
- wake a claim worker

## `claimSessionRun`

### Purpose

Lease the next runnable session run for a machine.

### Caller

- `POST /v2/session-runs/claim`

### Inputs

- `accountId`
- `machineId`
- `leaseDurationMs`

### Reads

- `Machine`
- eligible `SessionRun` rows in `queued`
- optional repository or automation assignment policy if scheduling later becomes more constrained

### Selection order

Recommended first landing:

- oldest queued run for the account and machine scope
- tie-break by `scheduledAt`, then `id`

### Writes

- set `state = claimed`
- set `claimedByMachineId`
- set `claimedAt`
- set `leaseExpiresAt`
- increment `attempt` only when the claim begins a fresh execution attempt, not for heartbeats
- append `SessionRunEvent(type="claimed")`

### Safety checks

- skip runs that are no longer the active primary run for the issue unless they are queued follow-ups by policy
- skip runs already leased to another live machine

### `afterTx()`

- emit machine and account-scoped update

## `heartbeatSessionRun`

### Purpose

Refresh a claimed or running run lease.

### Caller

- `POST /v2/session-runs/:runId/heartbeat`

### Inputs

- `accountId`
- `runId`
- `machineId`
- `generation`
- `leaseDurationMs`
- optional `headCommitSha`

### Reads

- `SessionRun`
- `IssueExecutionProjection`

### Writes

- extend `leaseExpiresAt`
- optionally cache newer `headCommitSha` if the runtime has progressed and the run is still current

### Return

- `{ ok: true, leaseExpiresAt, serverDirective }`

### Directives owned here

- `continue`
- `abort`
- `wait_user`

The directive is computed from current durable state, not from route-local logic.

## `startSessionRun`

### Purpose

Move a claimed run into `running`.

### Caller

- `POST /v2/session-runs/:runId/start`

### Inputs

- `accountId`
- `runId`
- `machineId`
- `generation`
- optional `branchName`
- optional `headCommitSha`

### Reads

- `SessionRun`
- `IssueExecutionProjection`

### Writes

- set `state = running`
- set `startedAt` if not already set
- cache branch and head metadata when present
- append `SessionRunEvent(type="started")`

### Idempotency

Starting an already running run should be a no-op success as long as machine and
generation still match.

## `waitUserSessionRun`

### Purpose

Represent a blocked-but-not-failed execution that requires a human decision.

### Caller

- `POST /v2/session-runs/:runId/wait-user`

### Inputs

- `accountId`
- `runId`
- `machineId`
- `generation`
- `reasonCode`
- optional `reasonMessage`

### Writes

- set `state = waiting_user`
- append `SessionRunEvent(type="waiting_user")`
- optionally preserve `leaseExpiresAt` only long enough for clean handoff; do not hold machine leases indefinitely

### Workflow effect

- does not advance workflow to `awaiting_review`
- does not clear the active primary run

## `completeSessionRun`

### Purpose

Finalize a successful execution attempt and hand off to writeback or review.

### Caller

- `POST /v2/session-runs/:runId/succeed`

### Inputs

- `accountId`
- `runId`
- `machineId`
- reported `generation`
- optional `branchName`
- optional provider change metadata
- optional `headCommitSha`
- optional summary payload

### Reads

- `SessionRun`
- `IssueExecutionProjection`
- current primary `SessionIssueLink`

### Preconditions

- run exists and belongs to the account
- machine still owns the lease or the design intentionally allows late success only when generation still matches
- reported generation matches durable generation

### Writes

- set `state = succeeded`
- set `finishedAt`
- persist freshest branch or provider change metadata
- append `SessionRunEvent(type="succeeded")`
- update `IssueExecutionProjection`
  - clear `activePrimaryRunId`
  - keep `activePrimarySessionId`
  - move to `change_open` or `awaiting_review` depending on whether the provider change already exists and is reviewable
- enqueue durable `ProviderActionRequest` rows for summary comment, link-back, or label sync

### Late-result rejection

Reject or no-op when:

- run generation is stale
- `IssueExecutionProjection.activePrimaryRunId` points at a newer run
- reported `headCommitSha` is older than the current workflow subject head

### `afterTx()`

- emit issue, run, and session updates
- wake provider action executor

## `failSessionRun`

### Purpose

Finalize a failed execution attempt without confusing infrastructure failure and
human-blocked failure.

### Caller

- `POST /v2/session-runs/:runId/fail`
- lease expiry recovery flow

### Inputs

- `accountId`
- `runId`
- `machineId`
- `generation`
- failure payload

### Preconditions

- if generation is stale, return the current run summary without mutating failure state
- if the machine lost the lease and a newer primary run exists, do not clobber the workflow projection

### Writes

- set `state = failed` or `expired` depending on source
- set `finishedAt`
- persist `errorCode` and `errorMessage`
- append `SessionRunEvent(type="failed")` or `SessionRunEvent(type="expired")`

### Workflow effect

- usually keep workflow at `executing` or `change_open`
- clear `activePrimaryRunId` only if the failed run was still the current primary run
- preserve `activePrimarySessionId` so retry can reuse context

### Retry ownership

This transaction does not itself create the retry run. It only leaves state in a
shape where a separate retry policy transaction can decide.

## `retrySessionRun`

### Purpose

Create a fresh execution attempt for the same issue after failure, verification
repair, or explicit `/retry`.

### Caller

- `POST /v2/session-runs/:runId/retry`
- automated recovery policy

### Reads

- source `SessionRun`
- current `IssueExecutionProjection`
- active `SessionIssueLink`

### Writes

- create a new `SessionRun`
  - `retryOfRunId = source run`
  - `generation = source generation + 1`
  - same `externalIssueRefId`
  - same primary session unless resolution policy overrides
  - same branch and provider change identity when possible
- append `SessionRunEvent(type="queued_retry")`
- update `IssueExecutionProjection.activePrimaryRunId`
- keep workflow in `executing` or `change_open`

### Idempotency

Retry requests need their own `idempotencyKey`. Reusing the original launch key
would collapse distinct attempts incorrectly.

## `abortSessionRun`

### Purpose

Perform an explicit user-requested terminal cancellation.

### Caller

- `POST /v2/session-runs/:runId/abort`

### Inputs

- `accountId`
- `runId`

### Writes

- set `state = cancelled`
- set `finishedAt`
- append `SessionRunEvent(type="cancelled")`
- clear `IssueExecutionProjection.activePrimaryRunId` if this run was still current

### Workflow effect

- usually keep `activePrimarySessionId` so the user can inspect or relaunch from the same session
- do not mark workflow `done`

## `enqueueProviderAction`

### Purpose

Materialize a durable provider side effect request from a committed state change.

### Caller

- `completeSessionRun`
- `upsertExternalIssueProjection`
- manual policy actions

### Inputs

- `accountId`
- `repositoryConnectionId`
- optional `sessionRunId`
- optional `externalIssueRefId`
- `actionKind`
- `executionMode`
- `idempotencyKey`
- `payload`

### Writes

- create `ProviderActionRequest` or return the existing one by idempotency key

### `afterTx()`

- wake the provider action executor if a new request was created

## `claimProviderAction`

### Purpose

Lease a provider writeback action for server-worker or machine-runtime execution.

### Caller

- background worker
- `POST /v2/provider-actions/claim` in Quickstart mode

### Reads

- next `ProviderActionRequest` in `queued`
- target machine if `executionMode = machine_runtime`

### Writes

- set `state = claimed`
- set `claimedByExecutorId`
- set `claimedAt`
- set `leaseExpiresAt`
- increment `attemptCount` when the claim begins a fresh provider-side write attempt

### Selection rule

- `server_worker` actions may be claimed by the server-side worker
- `machine_runtime` actions may only be claimed by the intended machine or an eligible replacement policy

## `heartbeatProviderAction`

### Purpose

Refresh the lease for a claimed or running provider action.

### Caller

- `POST /v2/provider-actions/:actionId/heartbeat`

### Writes

- verify claimant ownership
- extend `leaseExpiresAt`

## `startProviderAction`

### Purpose

Move a claimed provider action into `running` for observability and lease-safe execution.

### Caller

- server worker executor
- `POST /v2/provider-actions/:actionId/start` in Quickstart mode

### Writes

- set `state = running`
- set `startedAt` if absent

### Idempotency

Starting an already running action for the same claimant should be a no-op success.

## `completeProviderAction`

### Purpose

Finalize comment, label, assignee, link-back, or provider change mutations after
the side effect has actually completed.

### Caller

- server worker provider client
- Quickstart machine runtime

### Writes

- set `state = succeeded` or `failed`
- set `startedAt` and `finishedAt` when appropriate
- persist any provider external ids returned by the action

### Projection updates

If the provider action created or updated the current provider change, this
transaction may also update:

- `SessionRun.providerChange*`
- `IssueExecutionProjection.currentProviderChange*`

It must still respect generation and head SHA freshness.

## `applyVerificationUpdate`

### Purpose

Apply one local or remote verification result to the durable evidence model.

### Caller

- local runtime verify completion
- GitHub Actions or GitLab CI webhook normalization

### Inputs

- `accountId`
- `sessionRunId`
- `source`
- `subjectHeadSha`
- provider or runtime result payload

### Reads

- `SessionRun`
- `IssueExecutionProjection`
- existing `VerificationAttempt`
- `VerificationPolicy`

### Writes

- create or update `VerificationAttempt`
- upsert `VerificationSuiteResult`
- recalculate `VerificationProjection`
- append `SessionRunEvent(type="verification_updated")` only when the summary materially changes

### Freshness rule

Ignore stale verification when:

- `subjectHeadSha` does not match the current run head
- or the workflow projection already points to a newer subject head

### Workflow effect

Verification does not directly mark the issue `done`. At most it may move:

- `change_open -> awaiting_review`

when the provider change already exists and the run has otherwise completed.

## `applyMergeabilityUpdate`

### Purpose

Refresh provider merge-gate information without confusing it with verification or
workflow completion.

### Caller

- provider webhook
- periodic provider refresh

### Writes

- update `MergeabilityProjection`
- optionally append a run event when mergeability materially changes

### Freshness rule

Same as verification: stale `subjectHeadSha` must not replace newer mergeability.

## `claimRepositoryPollLease`

### Purpose

Own the Quickstart repository polling right for one machine.

### Caller

- `POST /v2/repositories/connections/:connectionId/poller/claim`

### Writes

- set `pollingOwnerMachineId`
- set `pollingLeaseExpiresAt`
- clear `degradedReason` when the lease becomes healthy

### Conflict rule

If another machine already holds a live lease, return `poller_lease_lost` to the
new claimant rather than silently stealing the lease.

## `heartbeatRepositoryPollLease`

### Purpose

Refresh the Quickstart poll lease for the machine that already owns it.

### Caller

- `POST /v2/repositories/connections/:connectionId/poller/heartbeat`

### Inputs

- `accountId`
- `repositoryConnectionId`
- `machineId`
- `leaseDurationMs`
- optional capability snapshot

### Reads

- `RepositoryConnection`

### Writes

- verify `pollingOwnerMachineId == machineId`
- extend `pollingLeaseExpiresAt`
- optionally refresh `capabilities` and `lastCapabilitySyncAt`
- clear `degradedReason` when the lease is healthy again

### Failure behavior

- return `poller_lease_lost` if another live owner already exists
- do not silently transfer ownership during heartbeat

## `pushPolledEvents`

### Purpose

Take a batch of normalized Quickstart events and hand them to the same receipt and
projection pipeline used by managed webhooks.

### Caller

- `POST /v2/repositories/connections/:connectionId/events/push`

### Shape

This should not be one giant transaction for the whole batch. Use:

1. lightweight gate check for repository poll lease ownership
2. one transaction per normalized event:
   - `recordProviderEventReceipt`
   - `upsertExternalIssueProjection`
   - optional `launchOrAttachSessionRun`

This keeps retries targeted and prevents one malformed event from aborting the
whole batch.

## Recovery Loops

Some state changes should be handled by background recovery loops rather than by
route handlers.

### Expire stale run leases

Worker loop:

- find `SessionRun` in `claimed` or `running` with expired `leaseExpiresAt`
- transition them to `expired`
- decide whether retry policy should call `retrySessionRun`

### Expire stale provider action leases

Worker loop:

- find `ProviderActionRequest` in `claimed` or `running` with expired lease
- return them to `queued` or mark `failed` based on attempt policy

### Repository degraded mode

Worker loop:

- mark `RepositoryConnection.degradedReason` when poll lease lapses or webhook health is unhealthy
- do not mutate active sessions or already-running runs
- block only automatic trigger creation

## Event Router And Change Fanout

These transactions should integrate with the existing account-change and socket
fanout patterns used elsewhere in Happier.

Recommended first landing:

- add an account change kind for issue-execution surfaces
- emit account-scoped updates after launch, claim, success, fail, verification change, and workflow transition
- emit session-scoped updates when the linked session's execution state changes

Do not try to invent a second parallel notification channel for issue execution.
Reuse the existing event router shape.

## First Vertical Slice

The minimum service transaction slice worth implementing first is:

- `recordProviderEventReceipt`
- `upsertExternalIssueProjection`
- `launchOrAttachSessionRun`
- `claimSessionRun`
- `startSessionRun`
- `completeSessionRun`
- `enqueueProviderAction`
- `claimProviderAction`
- `completeProviderAction`

That is enough to prove:

- managed webhook ingestion
- one active primary run per issue
- session creation plus reuse of the same primary session
- provider writeback through durable action requests
- transaction-safe wakeups via `afterTx()`
