import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "../../testkit/sqliteFastify";
import { externalIssueControlPlaneRoutes } from "./externalIssueControlPlaneRoutes";

async function createAccountWithMachine(machineId: string): Promise<{ accountId: string }> {
    const account = await db.account.create({
        data: { publicKey: `pk-${machineId}` },
        select: { id: true },
    });
    await db.machine.create({
        data: {
            id: machineId,
            accountId: account.id,
            metadata: "{}",
        },
    });
    return { accountId: account.id };
}

async function createMachine(accountId: string, machineId: string): Promise<void> {
    await db.machine.create({
        data: {
            id: machineId,
            accountId,
            metadata: "{}",
        },
    });
}

describe("external issue control plane routes (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-external-issue-control-plane-" });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    afterEach(async () => {
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.$executeRawUnsafe(`DELETE FROM "VerificationSuiteResult"`),
            () => db.$executeRawUnsafe(`DELETE FROM "VerificationAttempt"`),
            () => db.$executeRawUnsafe(`DELETE FROM "VerificationProjection"`),
            () => db.$executeRawUnsafe(`DELETE FROM "VerificationPolicy"`),
            () => db.$executeRawUnsafe(`DELETE FROM "MergeabilityProjection"`),
            () => db.$executeRawUnsafe(`DELETE FROM "ProviderActionRequest"`),
            () => db.$executeRawUnsafe(`DELETE FROM "SessionRunEvent"`),
            () => db.$executeRawUnsafe(`DELETE FROM "SessionRun"`),
            () => db.$executeRawUnsafe(`DELETE FROM "SessionIssueLink"`),
            () => db.$executeRawUnsafe(`DELETE FROM "IssueExecutionProjection"`),
            () => db.$executeRawUnsafe(`DELETE FROM "ProviderEventReceipt"`),
            () => db.$executeRawUnsafe(`DELETE FROM "ExternalIssueSyncCursor"`),
            () => db.$executeRawUnsafe(`DELETE FROM "ExternalIssueRef"`),
            () => db.$executeRawUnsafe(`DELETE FROM "RepositoryConnection"`),
            () => db.accountChange.deleteMany(),
            () => db.session.deleteMany(),
            () => db.machine.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    it("runs the manual launch -> claim -> start -> succeed -> provider action flow", async () => {
        const seeded = await createAccountWithMachine("machine-happy");

        await withAuthenticatedTestApp(
            externalIssueControlPlaneRoutes,
            async (app) => {
                const createConnection = await app.inject({
                    method: "POST",
                    url: "/v2/repositories/connections",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        provider: "github",
                        providerBaseUrl: "https://github.com",
                        repositoryKey: "acme/api",
                        mode: "managed",
                        authKind: "github_app",
                    },
                });
                expect(createConnection.statusCode).toBe(200);
                const createdConnection = createConnection.json() as any;
                expect(createdConnection.connection).toEqual(
                    expect.objectContaining({
                        provider: "github",
                        repositoryKey: "acme/api",
                        mode: "managed",
                        authKind: "github_app",
                        enabled: true,
                    }),
                );

                const listConnections = await app.inject({
                    method: "GET",
                    url: "/v2/repositories/connections?provider=github",
                    headers: {
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(listConnections.statusCode).toBe(200);
                expect(listConnections.json()).toEqual({
                    connections: [
                        expect.objectContaining({
                            id: createdConnection.connection.id,
                            repositoryKey: "acme/api",
                        }),
                    ],
                });

                const getConnection = await app.inject({
                    method: "GET",
                    url: `/v2/repositories/connections/${createdConnection.connection.id}`,
                    headers: {
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(getConnection.statusCode).toBe(200);
                expect(getConnection.json()).toEqual({
                    connection: expect.objectContaining({
                        id: createdConnection.connection.id,
                        repositoryKey: "acme/api",
                    }),
                });

                const resolveIssue = await app.inject({
                    method: "POST",
                    url: "/v2/external-issues/resolve",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        provider: "github",
                        providerBaseUrl: "https://github.com",
                        repositoryKey: "acme/api",
                        issueNumber: 123,
                    },
                });
                expect(resolveIssue.statusCode).toBe(200);
                const resolvedIssue = resolveIssue.json() as any;
                expect(resolvedIssue.issue).toEqual(
                    expect.objectContaining({
                        repositoryConnectionId: createdConnection.connection.id,
                        issueNumber: 123,
                        state: "open",
                    }),
                );

                const getIssue = await app.inject({
                    method: "GET",
                    url: `/v2/external-issues/${resolvedIssue.issue.id}`,
                    headers: {
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(getIssue.statusCode).toBe(200);
                expect(getIssue.json()).toEqual({
                    issue: expect.objectContaining({
                        id: resolvedIssue.issue.id,
                        issueNumber: 123,
                    }),
                    workflow: expect.objectContaining({
                        workflowState: "idle",
                    }),
                });

                const launch = await app.inject({
                    method: "POST",
                    url: `/v2/external-issues/${resolvedIssue.issue.id}/launch`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-happy",
                        idempotencyKey: "launch-happy-1",
                    },
                });
                expect(launch.statusCode).toBe(200);
                const launched = launch.json() as any;
                expect(launched.run).toEqual(
                    expect.objectContaining({
                        externalIssueRefId: resolvedIssue.issue.id,
                        repositoryConnectionId: createdConnection.connection.id,
                        state: "queued",
                        generation: 0,
                    }),
                );
                expect(launched.session).toEqual(expect.objectContaining({ id: expect.any(String) }));

                const storedSession = await db.session.findUnique({
                    where: { id: launched.session.id },
                    select: { id: true, accountId: true },
                });
                expect(storedSession).toEqual({ id: launched.session.id, accountId: seeded.accountId });

                const claim = await app.inject({
                    method: "POST",
                    url: "/v2/session-runs/claim",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-happy",
                    },
                });
                expect(claim.statusCode).toBe(200);
                const claimed = claim.json() as any;
                expect(claimed.run).toEqual(
                    expect.objectContaining({
                        id: launched.run.id,
                        state: "claimed",
                        claimedByMachineId: "machine-happy",
                        generation: 0,
                    }),
                );

                const heartbeat = await app.inject({
                    method: "POST",
                    url: `/v2/session-runs/${launched.run.id}/heartbeat`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-happy",
                        generation: 0,
                        leaseDurationMs: 45_000,
                        headCommitSha: "abc123",
                    },
                });
                expect(heartbeat.statusCode).toBe(200);
                expect(heartbeat.json()).toEqual({
                    ok: true,
                    leaseExpiresAt: expect.any(Number),
                    serverDirective: "continue",
                });

                const started = await app.inject({
                    method: "POST",
                    url: `/v2/session-runs/${launched.run.id}/start`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-happy",
                        generation: 0,
                        branchName: "codex/issue-123",
                        headCommitSha: "abc123",
                    },
                });
                expect(started.statusCode).toBe(200);
                expect(started.json()).toEqual({
                    run: expect.objectContaining({
                        id: launched.run.id,
                        state: "running",
                        branchName: "codex/issue-123",
                        headCommitSha: "abc123",
                    }),
                });

                const succeeded = await app.inject({
                    method: "POST",
                    url: `/v2/session-runs/${launched.run.id}/succeed`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-happy",
                        generation: 0,
                        branchName: "codex/issue-123",
                        providerChangeUrl: "https://github.com/acme/api/pull/17",
                        providerChangeNumber: 17,
                        providerChangeExternalId: "github-pr-17",
                        headCommitSha: "abc123",
                        summaryCiphertext: "summary-ciphertext",
                    },
                });
                expect(succeeded.statusCode).toBe(200);
                expect(succeeded.json()).toEqual({
                    run: expect.objectContaining({
                        id: launched.run.id,
                        state: "succeeded",
                        providerChangeExternalId: "github-pr-17",
                    }),
                    workflow: expect.objectContaining({
                        workflowState: "awaiting_review",
                        activePrimaryRunId: null,
                    }),
                });

                const claimedProviderAction = await app.inject({
                    method: "POST",
                    url: "/v2/provider-actions/claim",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-happy",
                    },
                });
                expect(claimedProviderAction.statusCode).toBe(200);
                const actionBody = claimedProviderAction.json() as any;
                expect(actionBody.action).toEqual(
                    expect.objectContaining({
                        sessionRunId: launched.run.id,
                        state: "claimed",
                        externalIssueRef: expect.objectContaining({
                            id: resolvedIssue.issue.id,
                            issueNumber: 123,
                        }),
                    }),
                );

                const startedProviderAction = await app.inject({
                    method: "POST",
                    url: `/v2/provider-actions/${actionBody.action.id}/start`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-happy",
                    },
                });
                expect(startedProviderAction.statusCode).toBe(200);

                const completedProviderAction = await app.inject({
                    method: "POST",
                    url: `/v2/provider-actions/${actionBody.action.id}/succeed`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-happy",
                        providerExternalId: "comment-42",
                        summary: "linked back to provider",
                    },
                });
                expect(completedProviderAction.statusCode).toBe(200);
                expect(completedProviderAction.json()).toEqual({
                    action: expect.objectContaining({
                        id: actionBody.action.id,
                        state: "succeeded",
                        providerExternalId: "comment-42",
                    }),
                });

                const getRun = await app.inject({
                    method: "GET",
                    url: `/v2/session-runs/${launched.run.id}`,
                    headers: {
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(getRun.statusCode).toBe(200);
                expect(getRun.json()).toEqual({
                    run: expect.objectContaining({
                        id: launched.run.id,
                        state: "succeeded",
                    }),
                    workflow: expect.objectContaining({
                        workflowState: "awaiting_review",
                    }),
                    session: expect.objectContaining({
                        id: launched.session.id,
                    }),
                    externalIssue: expect.objectContaining({
                        id: resolvedIssue.issue.id,
                        issueNumber: 123,
                    }),
                    repositoryConnection: expect.objectContaining({
                        id: createdConnection.connection.id,
                        repositoryKey: "acme/api",
                    }),
                    events: [
                        expect.objectContaining({ type: "queued" }),
                        expect.objectContaining({ type: "claimed" }),
                        expect.objectContaining({ type: "started" }),
                        expect.objectContaining({ type: "succeeded" }),
                    ],
                    verification: null,
                    mergeability: null,
                });

                const executionState = await app.inject({
                    method: "GET",
                    url: `/v2/external-issues/${resolvedIssue.issue.id}/execution-state`,
                    headers: {
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(executionState.statusCode).toBe(200);
                expect(executionState.json()).toEqual({
                    issue: expect.objectContaining({
                        id: resolvedIssue.issue.id,
                        issueNumber: 123,
                    }),
                    workflow: expect.objectContaining({
                        workflowState: "awaiting_review",
                        activePrimaryRunId: null,
                        currentProviderChangeExternalId: "github-pr-17",
                        currentProviderChangeUrl: "https://github.com/acme/api/pull/17",
                        subjectHeadSha: "abc123",
                    }),
                    activeRun: null,
                    latestRuns: [
                        expect.objectContaining({
                            id: launched.run.id,
                            state: "succeeded",
                            providerChangeExternalId: "github-pr-17",
                        }),
                    ],
                    providerActions: [
                        expect.objectContaining({
                            id: actionBody.action.id,
                            actionKind: "issue_link_back",
                            sessionRunId: launched.run.id,
                            state: "succeeded",
                            claimedByExecutorId: "machine-happy",
                            providerExternalId: "comment-42",
                        }),
                    ],
                    repositoryConnection: expect.objectContaining({
                        id: createdConnection.connection.id,
                        repositoryKey: "acme/api",
                    }),
                });

                const listRuns = await app.inject({
                    method: "GET",
                    url: `/v2/session-runs?externalIssueRefId=${encodeURIComponent(resolvedIssue.issue.id)}`,
                    headers: {
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(listRuns.statusCode).toBe(200);
                expect(listRuns.json()).toEqual({
                    runs: [
                        expect.objectContaining({
                            id: launched.run.id,
                            state: "succeeded",
                        }),
                    ],
                    nextCursor: null,
                });

                const runEvents = await db.sessionRunEvent.findMany({
                    where: { sessionRunId: launched.run.id },
                    orderBy: [{ ts: "asc" }],
                    select: { type: true },
                });
                expect(runEvents.map((event) => event.type)).toEqual(["queued", "claimed", "started", "succeeded"]);
            },
        );
    });

    it("keeps launch idempotent and supports fail -> retry -> abort", async () => {
        const seeded = await createAccountWithMachine("machine-recovery");

        await withAuthenticatedTestApp(
            externalIssueControlPlaneRoutes,
            async (app) => {
                const connectionRes = await app.inject({
                    method: "POST",
                    url: "/v2/repositories/connections",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        provider: "gitlab",
                        providerBaseUrl: "https://gitlab.example.com",
                        repositoryKey: "team/backend",
                        mode: "quickstart",
                        authKind: "glab_cli",
                        pollerEnabled: true,
                        pollingOwnerMachineId: "machine-recovery",
                    },
                });
                expect(connectionRes.statusCode).toBe(200);
                const connection = (connectionRes.json() as any).connection;

                const issueRes = await app.inject({
                    method: "POST",
                    url: "/v2/external-issues/resolve",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        provider: "gitlab",
                        providerBaseUrl: "https://gitlab.example.com",
                        repositoryKey: "team/backend",
                        issueNumber: 9,
                    },
                });
                expect(issueRes.statusCode).toBe(200);
                const issue = (issueRes.json() as any).issue;

                const launchBody = {
                    machineId: "machine-recovery",
                    idempotencyKey: "launch-recovery-1",
                };
                const firstLaunch = await app.inject({
                    method: "POST",
                    url: `/v2/external-issues/${issue.id}/launch`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: launchBody,
                });
                const secondLaunch = await app.inject({
                    method: "POST",
                    url: `/v2/external-issues/${issue.id}/launch`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: launchBody,
                });

                expect(firstLaunch.statusCode).toBe(200);
                expect(secondLaunch.statusCode).toBe(200);
                const firstRun = (firstLaunch.json() as any).run;
                const secondRun = (secondLaunch.json() as any).run;
                expect(secondRun.id).toBe(firstRun.id);

                const claim = await app.inject({
                    method: "POST",
                    url: "/v2/session-runs/claim",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-recovery",
                    },
                });
                expect(claim.statusCode).toBe(200);

                const fail = await app.inject({
                    method: "POST",
                    url: `/v2/session-runs/${firstRun.id}/fail`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-recovery",
                        generation: 0,
                        errorCode: "runtime_crashed",
                        errorMessage: "agent process exited",
                    },
                });
                expect(fail.statusCode).toBe(200);
                expect(fail.json()).toEqual({
                    run: expect.objectContaining({
                        id: firstRun.id,
                        state: "failed",
                        errorCode: "runtime_crashed",
                    }),
                    workflow: expect.objectContaining({
                        workflowState: "executing",
                        activePrimarySessionId: expect.any(String),
                        activePrimaryRunId: null,
                    }),
                });

                const retry = await app.inject({
                    method: "POST",
                    url: `/v2/session-runs/${firstRun.id}/retry`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-recovery",
                        idempotencyKey: "retry-recovery-2",
                    },
                });
                expect(retry.statusCode).toBe(200);
                const retried = retry.json() as any;
                expect(retried.run).toEqual(
                    expect.objectContaining({
                        repositoryConnectionId: connection.id,
                        externalIssueRefId: issue.id,
                        retryOfRunId: firstRun.id,
                        generation: 1,
                        state: "queued",
                    }),
                );

                const claimRetry = await app.inject({
                    method: "POST",
                    url: "/v2/session-runs/claim",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-recovery",
                    },
                });
                expect(claimRetry.statusCode).toBe(200);
                expect(claimRetry.json()).toEqual({
                    run: expect.objectContaining({
                        id: retried.run.id,
                        state: "claimed",
                        generation: 1,
                    }),
                });

                const startRetry = await app.inject({
                    method: "POST",
                    url: `/v2/session-runs/${retried.run.id}/start`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-recovery",
                        generation: 1,
                        branchName: "codex/retry-9",
                    },
                });
                expect(startRetry.statusCode).toBe(200);

                const waitUser = await app.inject({
                    method: "POST",
                    url: `/v2/session-runs/${retried.run.id}/wait-user`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-recovery",
                        generation: 1,
                        reasonCode: "permission_required",
                        reasonMessage: "needs elevated git write",
                    },
                });
                expect(waitUser.statusCode).toBe(200);
                expect(waitUser.json()).toEqual({
                    run: expect.objectContaining({
                        id: retried.run.id,
                        state: "waiting_user",
                    }),
                    workflow: expect.objectContaining({
                        activePrimaryRunId: retried.run.id,
                    }),
                });

                const abort = await app.inject({
                    method: "POST",
                    url: `/v2/session-runs/${retried.run.id}/abort`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(abort.statusCode).toBe(200);
                expect(abort.json()).toEqual({
                    run: expect.objectContaining({
                        id: retried.run.id,
                        state: "cancelled",
                    }),
                    workflow: expect.objectContaining({
                        activePrimaryRunId: null,
                    }),
                });

                const failedRunEvents = await db.sessionRunEvent.findMany({
                    where: { sessionRunId: firstRun.id },
                    orderBy: [{ ts: "asc" }],
                    select: { type: true },
                });
                expect(failedRunEvents.map((event) => event.type)).toEqual(["queued", "claimed", "failed"]);

                const retriedRunEvents = await db.sessionRunEvent.findMany({
                    where: { sessionRunId: retried.run.id },
                    orderBy: [{ ts: "asc" }],
                    select: { type: true },
                });
                expect(retriedRunEvents.map((event) => event.type)).toEqual(["queued_retry", "claimed", "started", "waiting_user", "cancelled"]);
            },
        );
    });

    it("expires stale claimed session runs and clears the active workflow pointer", async () => {
        const seeded = await createAccountWithMachine("machine-expire");

        await withAuthenticatedTestApp(
            externalIssueControlPlaneRoutes,
            async (app) => {
                const connectionRes = await app.inject({
                    method: "POST",
                    url: "/v2/repositories/connections",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        provider: "github",
                        providerBaseUrl: "https://github.com",
                        repositoryKey: "acme/expire",
                        mode: "managed",
                        authKind: "github_app",
                    },
                });
                expect(connectionRes.statusCode).toBe(200);

                const issueRes = await app.inject({
                    method: "POST",
                    url: "/v2/external-issues/resolve",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        provider: "github",
                        providerBaseUrl: "https://github.com",
                        repositoryKey: "acme/expire",
                        issueNumber: 10,
                    },
                });
                expect(issueRes.statusCode).toBe(200);
                const issue = (issueRes.json() as any).issue;

                const launch = await app.inject({
                    method: "POST",
                    url: `/v2/external-issues/${issue.id}/launch`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-expire",
                        idempotencyKey: "launch-expire-1",
                    },
                });
                expect(launch.statusCode).toBe(200);
                const run = (launch.json() as any).run;

                const claim = await app.inject({
                    method: "POST",
                    url: "/v2/session-runs/claim",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-expire",
                        leaseDurationMs: 5_000,
                    },
                });
                expect(claim.statusCode).toBe(200);
                await db.sessionRun.update({
                    where: { id: run.id },
                    data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
                });

                const expire = await app.inject({
                    method: "POST",
                    url: "/v2/session-runs/expire-stale",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-expire",
                    },
                });
                expect(expire.statusCode).toBe(200);
                expect(expire.json()).toEqual({
                    expired: [
                        expect.objectContaining({
                            id: run.id,
                            state: "expired",
                        }),
                    ],
                });

                const workflow = await db.issueExecutionProjection.findUniqueOrThrow({
                    where: { externalIssueRefId: issue.id },
                });
                expect(workflow).toEqual(
                    expect.objectContaining({
                        workflowState: "executing",
                        activePrimarySessionId: expect.any(String),
                        activePrimaryRunId: null,
                        transitionReason: "expired",
                    }),
                );

                const events = await db.sessionRunEvent.findMany({
                    where: { sessionRunId: run.id },
                    orderBy: [{ ts: "asc" }],
                    select: { type: true },
                });
                expect(events.map((event) => event.type)).toEqual(["queued", "claimed", "expired"]);
            },
        );
    });

    it("supports verification policy, poller leases, event push, and webhook receipt dedupe", async () => {
        const seeded = await createAccountWithMachine("machine-ingest");
        await createMachine(seeded.accountId, "machine-other");

        await withAuthenticatedTestApp(
            externalIssueControlPlaneRoutes,
            async (app) => {
                const createConnection = await app.inject({
                    method: "POST",
                    url: "/v2/repositories/connections",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        provider: "github",
                        providerBaseUrl: "https://github.com",
                        repositoryKey: "acme/worker",
                        mode: "quickstart",
                        authKind: "gh_cli",
                        pollerEnabled: true,
                        pollingOwnerMachineId: "machine-ingest",
                    },
                });
                expect(createConnection.statusCode).toBe(200);
                const connection = (createConnection.json() as any).connection;

                const refreshConnection = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/refresh`,
                    headers: {
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(refreshConnection.statusCode).toBe(200);
                expect(refreshConnection.json()).toEqual({
                    connection: expect.objectContaining({
                        id: connection.id,
                    }),
                });

                const upsertPolicy = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/verification-policy`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        requiresRemoteCi: true,
                        allowsLocalVerifyFallback: true,
                        autoMergeEligible: false,
                        blockingSuites: ["lint", "test"],
                        localVerifyCommands: ["yarn test"],
                    },
                });
                expect(upsertPolicy.statusCode).toBe(200);
                expect(upsertPolicy.json()).toEqual({
                    policy: expect.objectContaining({
                        repositoryConnectionId: connection.id,
                        requiresRemoteCi: true,
                        blockingSuites: ["lint", "test"],
                    }),
                });

                const getPolicy = await app.inject({
                    method: "GET",
                    url: `/v2/repositories/connections/${connection.id}/verification-policy`,
                    headers: {
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(getPolicy.statusCode).toBe(200);
                expect(getPolicy.json()).toEqual({
                    policy: expect.objectContaining({
                        repositoryConnectionId: connection.id,
                        localVerifyCommands: ["yarn test"],
                    }),
                });

                const claimPoller = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/poller/claim`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-ingest",
                    },
                });
                expect(claimPoller.statusCode).toBe(200);
                expect(claimPoller.json()).toEqual({
                    ok: true,
                    connection: expect.objectContaining({
                        id: connection.id,
                        pollingOwnerMachineId: "machine-ingest",
                    }),
                });

                const conflictingClaim = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/poller/claim`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-other",
                    },
                });
                expect(conflictingClaim.statusCode).toBe(409);
                expect(conflictingClaim.json()).toEqual({ error: "poll_lease_conflict" });

                const bindLocalCheckout = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/local-checkout`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-other",
                        localCheckoutPath: "/work/acme-local",
                    },
                });
                expect(bindLocalCheckout.statusCode).toBe(200);
                expect(bindLocalCheckout.json()).toEqual({
                    ok: true,
                    connection: expect.objectContaining({
                        id: connection.id,
                        pollingOwnerMachineId: "machine-ingest",
                        capabilities: expect.objectContaining({
                            localCheckoutMachineId: "machine-other",
                            localCheckoutPath: "/work/acme-local",
                        }),
                    }),
                });

                const heartbeatPoller = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/poller/heartbeat`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-ingest",
                        capabilities: {
                            webhookEnabled: false,
                            remoteCiDetected: true,
                            defaultBranch: "main",
                            localCheckoutPath: "/work/acme-worker",
                        },
                    },
                });
                expect(heartbeatPoller.statusCode).toBe(200);
                expect(heartbeatPoller.json()).toEqual({
                    ok: true,
                    connection: expect.objectContaining({
                        id: connection.id,
                        remoteCiDetected: true,
                        capabilities: expect.objectContaining({
                            localCheckoutPath: "/work/acme-worker",
                        }),
                    }),
                });

                await db.repositoryConnection.update({
                    where: { id: connection.id },
                    data: { pollingLeaseExpiresAt: new Date(Date.now() - 1_000) },
                });
                const expiredLeaseClaim = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/poller/claim`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-other",
                    },
                });
                expect(expiredLeaseClaim.statusCode).toBe(200);
                expect(expiredLeaseClaim.json()).toEqual({
                    ok: true,
                    connection: expect.objectContaining({
                        id: connection.id,
                        pollingOwnerMachineId: "machine-other",
                    }),
                });

                const reclaimPoller = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/poller/claim`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-ingest",
                    },
                });
                expect(reclaimPoller.statusCode).toBe(409);
                expect(reclaimPoller.json()).toEqual({ error: "poll_lease_conflict" });
                await db.repositoryConnection.update({
                    where: { id: connection.id },
                    data: {
                        pollingOwnerMachineId: "machine-ingest",
                        pollingLeaseExpiresAt: new Date(Date.now() + 30_000),
                    },
                });

                const pushEvents = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/events/push`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-ingest",
                        events: [
                            {
                                eventKey: "poll-evt-1",
                                occurredAt: 1760000000000,
                                kind: "issue.opened",
                                issueNumber: 44,
                                snapshot: {
                                    title: "CI bootstrap is flaky",
                                    state: "open",
                                    url: "https://github.com/acme/worker/issues/44",
                                },
                            },
                        ],
                    },
                });
                expect(pushEvents.statusCode).toBe(200);
                expect(pushEvents.json()).toEqual({
                    recorded: 1,
                    deduped: 0,
                    issues: [
                        expect.objectContaining({
                            issueNumber: 44,
                            title: "CI bootstrap is flaky",
                        }),
                    ],
                });
                const pollCreatedRuns = await db.sessionRun.findMany({
                    where: { accountId: seeded.accountId },
                    orderBy: [{ createdAt: "asc" }],
                });
                expect(pollCreatedRuns).toHaveLength(1);
                expect(pollCreatedRuns[0]).toEqual(
                    expect.objectContaining({
                        repositoryConnectionId: connection.id,
                        state: "queued",
                        triggerKind: "poll_event",
                        generation: 0,
                    }),
                );

                const pollWorkflow = await db.issueExecutionProjection.findUnique({
                    where: { externalIssueRefId: pollCreatedRuns[0].externalIssueRefId },
                });
                expect(pollWorkflow).toEqual(
                    expect.objectContaining({
                        workflowState: "executing",
                        activePrimaryRunId: pollCreatedRuns[0].id,
                    }),
                );

                const pushDuplicateEvents = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/events/push`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-ingest",
                        events: [
                            {
                                eventKey: "poll-evt-1",
                                occurredAt: 1760000000000,
                                kind: "issue.opened",
                                issueNumber: 44,
                                snapshot: {
                                    title: "CI bootstrap is flaky",
                                    state: "open",
                                    url: "https://github.com/acme/worker/issues/44",
                                },
                            },
                        ],
                    },
                });
                expect(pushDuplicateEvents.statusCode).toBe(200);
                expect(pushDuplicateEvents.json()).toEqual({
                    recorded: 0,
                    deduped: 1,
                    issues: [
                        expect.objectContaining({
                            issueNumber: 44,
                        }),
                    ],
                });
                await expect(
                    db.sessionRun.count({
                        where: {
                            accountId: seeded.accountId,
                            externalIssueRefId: pollCreatedRuns[0].externalIssueRefId,
                        },
                    }),
                ).resolves.toBe(1);

                const pushFollowupEvent = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/events/push`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-ingest",
                        events: [
                            {
                                eventKey: "poll-evt-2",
                                occurredAt: 1760000001000,
                                kind: "issue.comment",
                                issueNumber: 44,
                                snapshot: {
                                    title: "CI bootstrap is flaky",
                                    state: "open",
                                    url: "https://github.com/acme/worker/issues/44",
                                },
                            },
                        ],
                    },
                });
                expect(pushFollowupEvent.statusCode).toBe(200);
                await expect(
                    db.sessionRun.count({
                        where: {
                            accountId: seeded.accountId,
                            externalIssueRefId: pollCreatedRuns[0].externalIssueRefId,
                        },
                    }),
                ).resolves.toBe(1);

                const claimPollCreatedRun = await app.inject({
                    method: "POST",
                    url: "/v2/session-runs/claim",
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-ingest",
                        leaseDurationMs: 45_000,
                    },
                });
                expect(claimPollCreatedRun.statusCode).toBe(200);
                expect(claimPollCreatedRun.json()).toEqual({
                    run: expect.objectContaining({
                        id: pollCreatedRuns[0].id,
                        state: "claimed",
                        claimedByMachineId: "machine-ingest",
                        generation: 0,
                    }),
                });

                const startPollCreatedRun = await app.inject({
                    method: "POST",
                    url: `/v2/session-runs/${pollCreatedRuns[0].id}/start`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-ingest",
                        generation: 0,
                        branchName: "codex/issue-44",
                        headCommitSha: "poll-head-1",
                    },
                });
                expect(startPollCreatedRun.statusCode).toBe(200);
                expect(startPollCreatedRun.json()).toEqual({
                    run: expect.objectContaining({
                        id: pollCreatedRuns[0].id,
                        state: "running",
                        branchName: "codex/issue-44",
                        headCommitSha: "poll-head-1",
                    }),
                });

                const succeedPollCreatedRun = await app.inject({
                    method: "POST",
                    url: `/v2/session-runs/${pollCreatedRuns[0].id}/succeed`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-ingest",
                        generation: 0,
                        branchName: "codex/issue-44",
                        providerChangeUrl: "https://github.com/acme/worker/pull/44",
                        providerChangeNumber: 44,
                        providerChangeExternalId: "github-pr-44",
                        headCommitSha: "poll-head-1",
                    },
                });
                expect(succeedPollCreatedRun.statusCode).toBe(200);
                expect(succeedPollCreatedRun.json()).toEqual({
                    run: expect.objectContaining({
                        id: pollCreatedRuns[0].id,
                        state: "succeeded",
                        providerChangeExternalId: "github-pr-44",
                    }),
                    workflow: expect.objectContaining({
                        workflowState: "awaiting_review",
                        activePrimaryRunId: null,
                        currentProviderChangeExternalId: "github-pr-44",
                        currentProviderChangeUrl: "https://github.com/acme/worker/pull/44",
                    }),
                });

                const pollExecutionState = await app.inject({
                    method: "GET",
                    url: `/v2/external-issues/${pollCreatedRuns[0].externalIssueRefId}/execution-state`,
                    headers: {
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(pollExecutionState.statusCode).toBe(200);
                expect(pollExecutionState.json()).toEqual({
                    issue: expect.objectContaining({
                        issueNumber: 44,
                    }),
                    workflow: expect.objectContaining({
                        workflowState: "awaiting_review",
                        activePrimaryRunId: null,
                        currentProviderChangeExternalId: "github-pr-44",
                        subjectHeadSha: "poll-head-1",
                    }),
                    activeRun: null,
                    latestRuns: [
                        expect.objectContaining({
                            id: pollCreatedRuns[0].id,
                            state: "succeeded",
                            providerChangeExternalId: "github-pr-44",
                        }),
                    ],
                    providerActions: [
                        expect.objectContaining({
                            actionKind: "issue_link_back",
                            sessionRunId: pollCreatedRuns[0].id,
                            state: "queued",
                            targetMachineId: "machine-ingest",
                        }),
                    ],
                    repositoryConnection: expect.objectContaining({
                        id: connection.id,
                        repositoryKey: "acme/worker",
                    }),
                });
                const pushAfterTerminalEvent = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/events/push`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-ingest",
                        events: [
                            {
                                eventKey: "poll-evt-3",
                                occurredAt: 1760000002000,
                                kind: "issue.reopened",
                                issueNumber: 44,
                                snapshot: {
                                    title: "CI bootstrap is flaky",
                                    state: "open",
                                    url: "https://github.com/acme/worker/issues/44",
                                },
                            },
                        ],
                    },
                });
                expect(pushAfterTerminalEvent.statusCode).toBe(200);
                const runsAfterTerminalEvent = await db.sessionRun.findMany({
                    where: {
                        accountId: seeded.accountId,
                        externalIssueRefId: pollCreatedRuns[0].externalIssueRefId,
                    },
                    orderBy: [{ generation: "asc" }],
                });
                expect(runsAfterTerminalEvent).toHaveLength(2);
                expect(runsAfterTerminalEvent[1]).toEqual(
                    expect.objectContaining({
                        state: "queued",
                        triggerKind: "poll_event",
                        generation: 1,
                    }),
                );

                const pushWithoutLease = await app.inject({
                    method: "POST",
                    url: `/v2/repositories/connections/${connection.id}/events/push`,
                    headers: {
                        "content-type": "application/json",
                        "x-test-user-id": seeded.accountId,
                    },
                    payload: {
                        machineId: "machine-other",
                        events: [
                            {
                                eventKey: "poll-evt-other-machine",
                                occurredAt: 1760000003000,
                                kind: "issue.opened",
                                issueNumber: 47,
                            },
                        ],
                    },
                });
                expect(pushWithoutLease.statusCode).toBe(409);
                expect(pushWithoutLease.json()).toEqual({ error: "poll_lease_required" });
                await expect(
                    db.externalIssueRef.findFirst({
                        where: {
                            accountId: seeded.accountId,
                            repositoryConnectionId: connection.id,
                            issueNumber: 47,
                        },
                    }),
                ).resolves.toBeNull();

                const listIssues = await app.inject({
                    method: "GET",
                    url: `/v2/external-issues?repositoryConnectionId=${encodeURIComponent(connection.id)}`,
                    headers: {
                        "x-test-user-id": seeded.accountId,
                    },
                });
                expect(listIssues.statusCode).toBe(200);
                expect(listIssues.json()).toEqual({
                    issues: [
                        expect.objectContaining({
                            issueNumber: 44,
                            title: "CI bootstrap is flaky",
                            workflow: expect.objectContaining({
                                workflowState: "executing",
                                activePrimaryRunId: runsAfterTerminalEvent[1].id,
                            }),
                            activeRun: expect.objectContaining({
                                id: runsAfterTerminalEvent[1].id,
                                state: "queued",
                                generation: 1,
                            }),
                            latestRun: expect.objectContaining({
                                id: runsAfterTerminalEvent[1].id,
                                state: "queued",
                                generation: 1,
                            }),
                        }),
                    ],
                    nextCursor: null,
                });

                const [concurrentPushOne, concurrentPushTwo] = await Promise.all([
                    app.inject({
                        method: "POST",
                        url: `/v2/repositories/connections/${connection.id}/events/push`,
                        headers: {
                            "content-type": "application/json",
                            "x-test-user-id": seeded.accountId,
                        },
                        payload: {
                            machineId: "machine-ingest",
                            events: [
                                {
                                    eventKey: "poll-evt-concurrent-1",
                                    occurredAt: 1760000004000,
                                    kind: "issue.opened",
                                    issueNumber: 48,
                                    snapshot: {
                                        title: "Concurrent issue",
                                        state: "open",
                                        url: "https://github.com/acme/worker/issues/48",
                                    },
                                },
                            ],
                        },
                    }),
                    app.inject({
                        method: "POST",
                        url: `/v2/repositories/connections/${connection.id}/events/push`,
                        headers: {
                            "content-type": "application/json",
                            "x-test-user-id": seeded.accountId,
                        },
                        payload: {
                            machineId: "machine-ingest",
                            events: [
                                {
                                    eventKey: "poll-evt-concurrent-2",
                                    occurredAt: 1760000004001,
                                    kind: "issue.comment",
                                    issueNumber: 48,
                                    snapshot: {
                                        title: "Concurrent issue",
                                        state: "open",
                                        url: "https://github.com/acme/worker/issues/48",
                                    },
                                },
                            ],
                        },
                    }),
                ]);
                expect(concurrentPushOne.statusCode).toBe(200);
                expect(concurrentPushTwo.statusCode).toBe(200);
                const concurrentIssue = await db.externalIssueRef.findFirstOrThrow({
                    where: {
                        accountId: seeded.accountId,
                        repositoryConnectionId: connection.id,
                        issueNumber: 48,
                    },
                });
                await expect(
                    db.sessionRun.count({
                        where: {
                            accountId: seeded.accountId,
                            externalIssueRefId: concurrentIssue.id,
                            triggerKind: "poll_event",
                        },
                    }),
                ).resolves.toBe(1);

                const firstWebhook = await app.inject({
                    method: "POST",
                    url: "/v1/integrations/github/webhook",
                    headers: {
                        "content-type": "application/json",
                        "x-github-event": "issues",
                        "x-github-delivery": "delivery-1",
                    },
                    payload: {
                        action: "opened",
                        repository: {
                            html_url: "https://github.com/acme/worker",
                            full_name: "acme/worker",
                        },
                        issue: {
                            number: 45,
                            title: "Webhook issue",
                            state: "open",
                            html_url: "https://github.com/acme/worker/issues/45",
                        },
                    },
                });
                expect(firstWebhook.statusCode).toBe(202);
                expect(firstWebhook.json()).toEqual({
                    recorded: true,
                    deduped: false,
                });
                const webhookIssue = await db.externalIssueRef.findFirstOrThrow({
                    where: {
                        accountId: seeded.accountId,
                        repositoryConnectionId: connection.id,
                        issueNumber: 45,
                    },
                });
                await expect(
                    db.sessionRun.count({
                        where: {
                            accountId: seeded.accountId,
                            externalIssueRefId: webhookIssue.id,
                            triggerKind: "webhook_event",
                        },
                    }),
                ).resolves.toBe(1);

                const secondWebhook = await app.inject({
                    method: "POST",
                    url: "/v1/integrations/github/webhook",
                    headers: {
                        "content-type": "application/json",
                        "x-github-event": "issues",
                        "x-github-delivery": "delivery-1",
                    },
                    payload: {
                        action: "opened",
                        repository: {
                            html_url: "https://github.com/acme/worker",
                            full_name: "acme/worker",
                        },
                        issue: {
                            number: 45,
                            title: "Webhook issue",
                            state: "open",
                            html_url: "https://github.com/acme/worker/issues/45",
                        },
                    },
                });
                expect(secondWebhook.statusCode).toBe(202);
                expect(secondWebhook.json()).toEqual({
                    recorded: false,
                    deduped: true,
                });
                await expect(
                    db.sessionRun.count({
                        where: {
                            accountId: seeded.accountId,
                            externalIssueRefId: webhookIssue.id,
                        },
                    }),
                ).resolves.toBe(1);

                const gitlabWebhook = await app.inject({
                    method: "POST",
                    url: "/v1/integrations/gitlab/webhook",
                    headers: {
                        "content-type": "application/json",
                        "x-gitlab-event": "Issue Hook",
                        "x-gitlab-token": "token-1",
                    },
                    payload: {
                        event_type: "issue",
                        object_attributes: {
                            action: "open",
                            iid: 46,
                            title: "GitLab webhook issue",
                            state: "opened",
                            url: "https://github.com/acme/worker/-/issues/46",
                        },
                        project: {
                            web_url: "https://github.com/acme/worker",
                            path_with_namespace: "acme/worker",
                        },
                    },
                });
                expect(gitlabWebhook.statusCode).toBe(202);
                expect(gitlabWebhook.json()).toEqual({
                    recorded: true,
                    deduped: false,
                });
            },
        );
    });
});
