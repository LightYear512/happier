import {
    db,
    IssueWorkflowState,
    ProviderActionExecutionMode,
    ProviderActionKind,
    ProviderActionState,
    SessionRunState,
} from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { type Tx } from "@/storage/inTx";
import {
    buildExternalIssueSessionTag,
    ensureOwnedMachine,
    ensurePrimaryIssueSessionLink,
    getIssueWorkflowOrDefault,
    isClaimableRunState,
    resolveLeaseExpiresAt,
    upsertIssueWorkflowProjection,
} from "@/app/externalIssues/controlPlaneShared";

const EXTERNAL_ISSUE_SESSION_METADATA = "external-issue-session";
type SessionRunStateValue = (typeof SessionRunState)[keyof typeof SessionRunState];
const ACTIVE_SESSION_RUN_STATES = [
    SessionRunState.queued,
    SessionRunState.claimed,
    SessionRunState.running,
    SessionRunState.waiting_user,
] as const;

function toJsonSafe<T>(value: T): T {
    if (typeof value === "bigint") {
        return Number(value) as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => toJsonSafe(item)) as T;
    }
    if (value && typeof value === "object" && !(value instanceof Date) && !ArrayBuffer.isView(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]),
        ) as T;
    }
    return value;
}

type SessionRunFilters = Readonly<{
    sessionId?: string;
    externalIssueRefId?: string;
    repositoryConnectionId?: string;
    state?: SessionRunStateValue;
}>;

async function appendSessionRunEvent(params: Readonly<{
    tx: Tx;
    accountId: string;
    sessionRunId: string;
    type: string;
    payload?: Record<string, unknown>;
}>) {
    await params.tx.sessionRunEvent.create({
        data: {
            accountId: params.accountId,
            sessionRunId: params.sessionRunId,
            type: params.type,
            payload: params.payload ?? null,
        },
    });
}

async function clearActiveWorkflowRunIfCurrent(params: Readonly<{
    tx: Tx;
    accountId: string;
    runId: string;
    externalIssueRefId: string;
    sessionId: string;
    workflowState: typeof IssueWorkflowState[keyof typeof IssueWorkflowState];
    subjectHeadSha?: string | null;
    transitionReason: string;
}>) {
    await params.tx.issueExecutionProjection.updateMany({
        where: {
            accountId: params.accountId,
            externalIssueRefId: params.externalIssueRefId,
            activePrimaryRunId: params.runId,
        },
        data: {
            workflowState: params.workflowState,
            activePrimarySessionId: params.sessionId,
            activePrimaryRunId: null,
            subjectHeadSha: params.subjectHeadSha ?? null,
            transitionReason: params.transitionReason,
        },
    });
    const workflow = await params.tx.issueExecutionProjection.findUnique({
        where: { externalIssueRefId: params.externalIssueRefId },
    });
    return workflow ?? {
        id: `workflow:${params.externalIssueRefId}`,
        accountId: params.accountId,
        externalIssueRefId: params.externalIssueRefId,
        workflowState: IssueWorkflowState.idle,
        activePrimarySessionId: null,
        activePrimaryRunId: null,
        currentProviderChangeExternalId: null,
        currentProviderChangeUrl: null,
        subjectHeadSha: null,
        transitionReason: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
    };
}

async function createExternalIssueSession(params: Readonly<{
    tx: Tx;
    accountId: string;
    issueNumber: number;
}>) {
    return await params.tx.session.create({
        data: {
            accountId: params.accountId,
            tag: buildExternalIssueSessionTag(params.issueNumber),
            encryptionMode: "e2ee",
            metadata: EXTERNAL_ISSUE_SESSION_METADATA,
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 0,
            seq: 0,
            pendingVersion: 0,
            pendingCount: 0,
            active: true,
        },
    });
}

export async function ensureAutomatedSessionRunForIssue(params: Readonly<{
    tx: Tx;
    accountId: string;
    issueRefId: string;
    triggerKind: "poll_event" | "webhook_event";
    idempotencyKey: string;
}>) {
    const issue = await params.tx.externalIssueRef.findFirst({
        where: {
            id: params.issueRefId,
            accountId: params.accountId,
        },
    });
    if (!issue || issue.state !== "open") {
        return null;
    }

    const activeRun = await params.tx.sessionRun.findFirst({
        where: {
            accountId: params.accountId,
            externalIssueRefId: issue.id,
            state: { in: [...ACTIVE_SESSION_RUN_STATES] },
        },
        orderBy: [{ generation: "desc" }, { createdAt: "desc" }],
    });
    if (activeRun) {
        const session = await params.tx.session.findFirst({
            where: {
                id: activeRun.sessionId,
                accountId: params.accountId,
            },
        });
        if (!session) {
            return null;
        }
        await ensurePrimaryIssueSessionLink({
            tx: params.tx,
            accountId: params.accountId,
            sessionId: session.id,
            externalIssueRefId: issue.id,
        });
        await upsertIssueWorkflowProjection({
            tx: params.tx,
            accountId: params.accountId,
            externalIssueRefId: issue.id,
            workflowState: IssueWorkflowState.executing,
            activePrimarySessionId: session.id,
            activePrimaryRunId: activeRun.id,
            transitionReason: params.triggerKind,
        });
        return toJsonSafe({ run: activeRun, session });
    }

    const existingRun = await params.tx.sessionRun.findFirst({
        where: {
            accountId: params.accountId,
            idempotencyKey: params.idempotencyKey,
        },
    });
    if (existingRun) {
        const session = await params.tx.session.findFirst({
            where: {
                id: existingRun.sessionId,
                accountId: params.accountId,
            },
        });
        return session ? toJsonSafe({ run: existingRun, session }) : null;
    }

    const activeLink = await params.tx.sessionIssueLink.findFirst({
        where: {
            accountId: params.accountId,
            externalIssueRefId: issue.id,
            relation: "primary",
            active: true,
        },
        orderBy: [{ updatedAt: "desc" }],
        select: { sessionId: true },
    });
    const linkedSession = activeLink
        ? await params.tx.session.findFirst({
            where: {
                id: activeLink.sessionId,
                accountId: params.accountId,
            },
        })
        : null;
    const session = linkedSession ?? await createExternalIssueSession({
        tx: params.tx,
        accountId: params.accountId,
        issueNumber: issue.issueNumber,
    });

    const previousRun = await params.tx.sessionRun.findFirst({
        where: {
            accountId: params.accountId,
            externalIssueRefId: issue.id,
        },
        orderBy: [{ generation: "desc" }],
    });

    await ensurePrimaryIssueSessionLink({
        tx: params.tx,
        accountId: params.accountId,
        sessionId: session.id,
        externalIssueRefId: issue.id,
    });

    const run = await params.tx.sessionRun.create({
        data: {
            accountId: params.accountId,
            repositoryConnectionId: issue.repositoryConnectionId,
            sessionId: session.id,
            externalIssueRefId: issue.id,
            state: SessionRunState.queued,
            triggerKind: params.triggerKind,
            idempotencyKey: params.idempotencyKey,
            generation: previousRun ? previousRun.generation + 1 : 0,
            dueAt: new Date(),
        },
    });
    await appendSessionRunEvent({
        tx: params.tx,
        accountId: params.accountId,
        sessionRunId: run.id,
        type: "queued",
        payload: {
            triggerKind: params.triggerKind,
            idempotencyKey: params.idempotencyKey,
        },
    });

    await upsertIssueWorkflowProjection({
        tx: params.tx,
        accountId: params.accountId,
        externalIssueRefId: issue.id,
        workflowState: IssueWorkflowState.executing,
        activePrimarySessionId: session.id,
        activePrimaryRunId: run.id,
        transitionReason: params.triggerKind,
    });

    return toJsonSafe({ run, session });
}

async function loadSessionRunWorkflow(accountId: string, runId: string) {
    const run = await db.sessionRun.findFirst({
        where: {
            id: runId,
            accountId,
        },
    });
    if (!run) {
        return null;
    }
    const [
        workflow,
        session,
        repositoryConnection,
        externalIssue,
        verification,
        mergeability,
        events,
    ] = await Promise.all([
        getIssueWorkflowOrDefault(accountId, run.externalIssueRefId),
        db.session.findFirst({
            where: {
                id: run.sessionId,
                accountId,
            },
        }),
        db.repositoryConnection.findFirst({
            where: {
                id: run.repositoryConnectionId,
                accountId,
            },
        }),
        db.externalIssueRef.findFirst({
            where: {
                id: run.externalIssueRefId,
                accountId,
            },
        }),
        db.verificationProjection.findUnique({
            where: { sessionRunId: run.id },
        }),
        db.mergeabilityProjection.findUnique({
            where: { sessionRunId: run.id },
        }),
        db.sessionRunEvent.findMany({
            where: {
                accountId,
                sessionRunId: run.id,
            },
            orderBy: [{ ts: "asc" }],
            take: 50,
        }),
    ]);
    return toJsonSafe({ run, workflow, session, repositoryConnection, externalIssue, verification, mergeability, events });
}

export async function launchOrAttachSessionRun(params: Readonly<{
    accountId: string;
    issueRefId: string;
    sessionId?: string | null;
    machineId?: string | null;
    forceNewSession?: boolean;
    comment?: string;
    idempotencyKey: string;
}>) {
    return await inTx(async (tx) => {
        const existingRun = await tx.sessionRun.findFirst({
            where: {
                accountId: params.accountId,
                idempotencyKey: params.idempotencyKey,
            },
        });
        if (existingRun) {
            const existingSession = await tx.session.findUnique({
                where: { id: existingRun.sessionId },
            });
            if (!existingSession) {
                return null;
            }
            return toJsonSafe({ run: existingRun, session: existingSession });
        }

        const issue = await tx.externalIssueRef.findFirst({
            where: {
                id: params.issueRefId,
                accountId: params.accountId,
            },
        });
        if (!issue) {
            return null;
        }

        let session = null;
        if (params.sessionId) {
            session = await tx.session.findFirst({
                where: {
                    id: params.sessionId,
                    accountId: params.accountId,
                },
            });
        }

        if (!session && params.forceNewSession !== true) {
            const activeLink = await tx.sessionIssueLink.findFirst({
                where: {
                    accountId: params.accountId,
                    externalIssueRefId: issue.id,
                    relation: "primary",
                    active: true,
                },
                orderBy: [{ updatedAt: "desc" }],
                select: { sessionId: true },
            });
            if (activeLink) {
                session = await tx.session.findFirst({
                    where: {
                        id: activeLink.sessionId,
                        accountId: params.accountId,
                    },
                });
            }
        }

        if (!session) {
            session = await createExternalIssueSession({
                tx,
                accountId: params.accountId,
                issueNumber: issue.issueNumber,
            });
        }

        const previousRun = await tx.sessionRun.findFirst({
            where: {
                accountId: params.accountId,
                externalIssueRefId: issue.id,
            },
            orderBy: [{ generation: "desc" }],
        });

        await ensurePrimaryIssueSessionLink({
            tx,
            accountId: params.accountId,
            sessionId: session.id,
            externalIssueRefId: issue.id,
        });

        const run = await tx.sessionRun.create({
            data: {
                accountId: params.accountId,
                repositoryConnectionId: issue.repositoryConnectionId,
                sessionId: session.id,
                externalIssueRefId: issue.id,
                state: SessionRunState.queued,
                triggerKind: params.comment?.trim() ? "manual_comment" : "manual_launch",
                idempotencyKey: params.idempotencyKey,
                generation: previousRun ? previousRun.generation + 1 : 0,
                dueAt: new Date(),
            },
        });
        await appendSessionRunEvent({
            tx,
            accountId: params.accountId,
            sessionRunId: run.id,
            type: "queued",
            payload: {
                triggerKind: run.triggerKind,
                idempotencyKey: params.idempotencyKey,
            },
        });

        await upsertIssueWorkflowProjection({
            tx,
            accountId: params.accountId,
            externalIssueRefId: issue.id,
            workflowState: IssueWorkflowState.executing,
            activePrimarySessionId: session.id,
            activePrimaryRunId: run.id,
            transitionReason: "launch",
        });

        return toJsonSafe({ run, session });
    });
}

export async function listSessionRuns(accountId: string, filters: SessionRunFilters) {
    const runs = await db.sessionRun.findMany({
        where: {
            accountId,
            sessionId: filters.sessionId,
            externalIssueRefId: filters.externalIssueRefId,
            repositoryConnectionId: filters.repositoryConnectionId,
            state: filters.state,
        },
        orderBy: [{ createdAt: "asc" }],
    });
    return toJsonSafe(runs);
}

export async function getSessionRun(accountId: string, runId: string) {
    const result = await loadSessionRunWorkflow(accountId, runId);
    return result ? toJsonSafe(result) : null;
}

export async function claimSessionRun(params: Readonly<{
    accountId: string;
    machineId: string;
    leaseDurationMs?: number;
}>) {
    return await inTx(async (tx) => {
        const machineOwned = await ensureOwnedMachine(tx, params.accountId, params.machineId);
        if (!machineOwned) {
            return null;
        }

        const now = new Date();
        const leaseExpiresAt = resolveLeaseExpiresAt({ now, leaseDurationMs: params.leaseDurationMs });
        const candidates = await tx.sessionRun.findMany({
            where: {
                accountId: params.accountId,
                OR: [
                    { state: SessionRunState.queued },
                    { state: SessionRunState.claimed, leaseExpiresAt: { lt: now } },
                    { state: SessionRunState.running, leaseExpiresAt: { lt: now } },
                    { state: SessionRunState.waiting_user, leaseExpiresAt: { lt: now } },
                ],
            },
            orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
            take: 25,
        });

        for (const candidate of candidates) {
            if (!isClaimableRunState(candidate.state, candidate.leaseExpiresAt, now)) {
                continue;
            }

            const updated = candidate.state === SessionRunState.queued
                ? await tx.sessionRun.updateMany({
                    where: {
                        id: candidate.id,
                        accountId: params.accountId,
                        state: SessionRunState.queued,
                    },
                    data: {
                        state: SessionRunState.claimed,
                        claimedAt: now,
                        claimedByMachineId: params.machineId,
                        leaseExpiresAt,
                        attempt: { increment: 1 },
                    },
                })
                : await tx.sessionRun.updateMany({
                    where: {
                        id: candidate.id,
                        accountId: params.accountId,
                        state: {
                            in: [SessionRunState.claimed, SessionRunState.running, SessionRunState.waiting_user],
                        },
                        leaseExpiresAt: { lt: now },
                    },
                    data: {
                        state: SessionRunState.claimed,
                        claimedAt: now,
                        claimedByMachineId: params.machineId,
                        leaseExpiresAt,
                        attempt: { increment: 1 },
                    },
                });
            if (updated.count !== 1) {
                continue;
            }

            const claimedRun = await tx.sessionRun.findUnique({
                where: { id: candidate.id },
            });
            if (!claimedRun) {
                return null;
            }
            await appendSessionRunEvent({
                tx,
                accountId: params.accountId,
                sessionRunId: claimedRun.id,
                type: "claimed",
                payload: {
                    machineId: params.machineId,
                    attempt: claimedRun.attempt,
                    leaseExpiresAt: claimedRun.leaseExpiresAt?.toISOString() ?? null,
                },
            });
            return toJsonSafe(claimedRun);
        }

        return null;
    });
}

export async function heartbeatSessionRun(params: Readonly<{
    accountId: string;
    runId: string;
    machineId: string;
    generation: number;
    leaseDurationMs?: number;
    headCommitSha?: string;
}>) {
    return await inTx(async (tx) => {
        const leaseExpiresAt = resolveLeaseExpiresAt({ leaseDurationMs: params.leaseDurationMs });
        const updated = await tx.sessionRun.updateMany({
            where: {
                id: params.runId,
                accountId: params.accountId,
                claimedByMachineId: params.machineId,
                generation: params.generation,
                state: {
                    in: [SessionRunState.claimed, SessionRunState.running, SessionRunState.waiting_user],
                },
            },
            data: {
                leaseExpiresAt,
                headCommitSha: params.headCommitSha ?? undefined,
            },
        });
        if (updated.count !== 1) {
            return null;
        }
        return toJsonSafe({
            ok: true,
            leaseExpiresAt,
            serverDirective: "continue" as const,
        });
    });
}

export async function startSessionRun(params: Readonly<{
    accountId: string;
    runId: string;
    machineId: string;
    generation: number;
    branchName?: string;
    headCommitSha?: string;
}>) {
    return await inTx(async (tx) => {
        const now = new Date();
        const updated = await tx.sessionRun.updateMany({
            where: {
                id: params.runId,
                accountId: params.accountId,
                claimedByMachineId: params.machineId,
                generation: params.generation,
                state: SessionRunState.claimed,
            },
            data: {
                state: SessionRunState.running,
                startedAt: now,
                branchName: params.branchName ?? null,
                headCommitSha: params.headCommitSha ?? null,
            },
        });
        if (updated.count !== 1) {
            return null;
        }
        const run = await tx.sessionRun.findUnique({
            where: { id: params.runId },
        });
        if (!run) {
            return null;
        }
        await appendSessionRunEvent({
            tx,
            accountId: params.accountId,
            sessionRunId: run.id,
            type: "started",
            payload: {
                machineId: params.machineId,
                branchName: run.branchName,
                headCommitSha: run.headCommitSha,
            },
        });
        return toJsonSafe(run);
    });
}

export async function waitUserSessionRun(params: Readonly<{
    accountId: string;
    runId: string;
    machineId: string;
    generation: number;
    reasonCode: string;
    reasonMessage?: string;
}>) {
    return await inTx(async (tx) => {
        const updated = await tx.sessionRun.updateMany({
            where: {
                id: params.runId,
                accountId: params.accountId,
                claimedByMachineId: params.machineId,
                generation: params.generation,
                state: {
                    in: [SessionRunState.claimed, SessionRunState.running],
                },
            },
            data: {
                state: SessionRunState.waiting_user,
                errorCode: params.reasonCode,
                errorMessage: params.reasonMessage ?? null,
            },
        });
        if (updated.count !== 1) {
            return null;
        }

        const run = await tx.sessionRun.findUnique({
            where: { id: params.runId },
        });
        if (!run) {
            return null;
        }
        await appendSessionRunEvent({
            tx,
            accountId: params.accountId,
            sessionRunId: run.id,
            type: "waiting_user",
            payload: {
                machineId: params.machineId,
                reasonCode: params.reasonCode,
                reasonMessage: params.reasonMessage ?? null,
            },
        });

        const workflow = await upsertIssueWorkflowProjection({
            tx,
            accountId: params.accountId,
            externalIssueRefId: run.externalIssueRefId,
            workflowState: IssueWorkflowState.executing,
            activePrimarySessionId: run.sessionId,
            activePrimaryRunId: run.id,
            subjectHeadSha: run.headCommitSha ?? null,
            transitionReason: "wait_user",
        });
        return toJsonSafe({ run, workflow });
    });
}

export async function completeSessionRun(params: Readonly<{
    accountId: string;
    runId: string;
    machineId: string;
    generation: number;
    branchName?: string;
    providerChangeUrl?: string;
    providerChangeNumber?: number;
    providerChangeExternalId?: string;
    headCommitSha?: string;
    baseCommitSha?: string;
    summaryCiphertext?: string;
}>) {
    return await inTx(async (tx) => {
        const now = new Date();
        const updated = await tx.sessionRun.updateMany({
            where: {
                id: params.runId,
                accountId: params.accountId,
                claimedByMachineId: params.machineId,
                generation: params.generation,
                state: {
                    in: [SessionRunState.claimed, SessionRunState.running, SessionRunState.waiting_user],
                },
            },
            data: {
                state: SessionRunState.succeeded,
                finishedAt: now,
                branchName: params.branchName ?? null,
                providerChangeUrl: params.providerChangeUrl ?? null,
                providerChangeNumber: params.providerChangeNumber ?? null,
                providerChangeExternalId: params.providerChangeExternalId ?? null,
                headCommitSha: params.headCommitSha ?? null,
                baseCommitSha: params.baseCommitSha ?? null,
                summaryCiphertext: params.summaryCiphertext ?? null,
            },
        });
        if (updated.count !== 1) {
            return null;
        }

        const run = await tx.sessionRun.findUnique({
            where: { id: params.runId },
        });
        if (!run) {
            return null;
        }
        await appendSessionRunEvent({
            tx,
            accountId: params.accountId,
            sessionRunId: run.id,
            type: "succeeded",
            payload: {
                machineId: params.machineId,
                providerChangeExternalId: run.providerChangeExternalId,
                providerChangeUrl: run.providerChangeUrl,
            },
        });

        const issue = await tx.externalIssueRef.findUnique({
            where: { id: run.externalIssueRefId },
            select: {
                provider: true,
                repositoryKey: true,
            },
        });
        if (!issue) {
            return null;
        }

        const workflow = await upsertIssueWorkflowProjection({
            tx,
            accountId: params.accountId,
            externalIssueRefId: run.externalIssueRefId,
            workflowState: IssueWorkflowState.awaiting_review,
            activePrimarySessionId: run.sessionId,
            activePrimaryRunId: null,
            currentProviderChangeExternalId: run.providerChangeExternalId ?? null,
            currentProviderChangeUrl: run.providerChangeUrl ?? null,
            subjectHeadSha: run.headCommitSha ?? null,
            transitionReason: "succeeded",
        });

        const existingAction = await tx.providerActionRequest.findFirst({
            where: {
                accountId: params.accountId,
                idempotencyKey: `provider-action:${run.id}:issue-link-back`,
            },
            select: { id: true },
        });
        if (!existingAction) {
            await tx.providerActionRequest.create({
                data: {
                    accountId: params.accountId,
                    repositoryConnectionId: run.repositoryConnectionId,
                    sessionRunId: run.id,
                    externalIssueRefId: run.externalIssueRefId,
                    provider: issue.provider,
                    repositoryKey: issue.repositoryKey,
                    actionKind: ProviderActionKind.issue_link_back,
                    executionMode: ProviderActionExecutionMode.machine_runtime,
                    state: ProviderActionState.queued,
                    targetMachineId: params.machineId,
                    idempotencyKey: `provider-action:${run.id}:issue-link-back`,
                    payload: {
                        providerChangeUrl: run.providerChangeUrl,
                        providerChangeNumber: run.providerChangeNumber,
                        providerChangeExternalId: run.providerChangeExternalId,
                    },
                },
            });
        }

        return toJsonSafe({ run, workflow });
    });
}

export async function failSessionRun(params: Readonly<{
    accountId: string;
    runId: string;
    machineId: string;
    generation: number;
    errorCode?: string;
    errorMessage?: string;
    headCommitSha?: string;
    retryRecommended?: boolean;
}>) {
    return await inTx(async (tx) => {
        const now = new Date();
        const updated = await tx.sessionRun.updateMany({
            where: {
                id: params.runId,
                accountId: params.accountId,
                claimedByMachineId: params.machineId,
                generation: params.generation,
                state: {
                    in: [SessionRunState.claimed, SessionRunState.running, SessionRunState.waiting_user],
                },
            },
            data: {
                state: SessionRunState.failed,
                finishedAt: now,
                errorCode: params.errorCode ?? null,
                errorMessage: params.errorMessage ?? null,
                headCommitSha: params.headCommitSha ?? null,
            },
        });
        if (updated.count !== 1) {
            return null;
        }

        const run = await tx.sessionRun.findUnique({
            where: { id: params.runId },
        });
        if (!run) {
            return null;
        }
        await appendSessionRunEvent({
            tx,
            accountId: params.accountId,
            sessionRunId: run.id,
            type: "failed",
            payload: {
                machineId: params.machineId,
                errorCode: params.errorCode ?? null,
                retryRecommended: params.retryRecommended === true,
            },
        });

        const workflow = await clearActiveWorkflowRunIfCurrent({
            tx,
            accountId: params.accountId,
            externalIssueRefId: run.externalIssueRefId,
            workflowState: IssueWorkflowState.executing,
            runId: run.id,
            sessionId: run.sessionId,
            subjectHeadSha: run.headCommitSha ?? null,
            transitionReason: params.retryRecommended === true ? "retry_recommended" : "failed",
        });
        return toJsonSafe({ run, workflow });
    });
}

export async function retrySessionRun(params: Readonly<{
    accountId: string;
    runId: string;
    machineId?: string | null;
    reason?: string;
    idempotencyKey: string;
}>) {
    return await inTx(async (tx) => {
        const existingRun = await tx.sessionRun.findFirst({
            where: {
                accountId: params.accountId,
                idempotencyKey: params.idempotencyKey,
            },
        });
        if (existingRun) {
            return toJsonSafe(existingRun);
        }

        const sourceRun = await tx.sessionRun.findFirst({
            where: {
                id: params.runId,
                accountId: params.accountId,
            },
        });
        if (!sourceRun) {
            return null;
        }

        const retriedRun = await tx.sessionRun.create({
            data: {
                accountId: params.accountId,
                repositoryConnectionId: sourceRun.repositoryConnectionId,
                sessionId: sourceRun.sessionId,
                externalIssueRefId: sourceRun.externalIssueRefId,
                state: SessionRunState.queued,
                triggerKind: params.reason?.trim() ? "manual_retry_reasoned" : "manual_retry",
                idempotencyKey: params.idempotencyKey,
                generation: sourceRun.generation + 1,
                retryOfRunId: sourceRun.id,
                dueAt: new Date(),
            },
        });
        await appendSessionRunEvent({
            tx,
            accountId: params.accountId,
            sessionRunId: retriedRun.id,
            type: "queued_retry",
            payload: {
                retryOfRunId: sourceRun.id,
                reason: params.reason ?? null,
                idempotencyKey: params.idempotencyKey,
            },
        });

        await upsertIssueWorkflowProjection({
            tx,
            accountId: params.accountId,
            externalIssueRefId: sourceRun.externalIssueRefId,
            workflowState: IssueWorkflowState.executing,
            activePrimarySessionId: sourceRun.sessionId,
            activePrimaryRunId: retriedRun.id,
            subjectHeadSha: sourceRun.headCommitSha ?? null,
            transitionReason: "retry",
        });

        return toJsonSafe(retriedRun);
    });
}

export async function abortSessionRun(params: Readonly<{
    accountId: string;
    runId: string;
    reason?: string;
}>) {
    return await inTx(async (tx) => {
        const now = new Date();
        const updated = await tx.sessionRun.updateMany({
            where: {
                id: params.runId,
                accountId: params.accountId,
                state: {
                    notIn: [SessionRunState.succeeded, SessionRunState.cancelled, SessionRunState.expired],
                },
            },
            data: {
                state: SessionRunState.cancelled,
                finishedAt: now,
                errorMessage: params.reason ?? undefined,
            },
        });
        if (updated.count !== 1) {
            return null;
        }

        const run = await tx.sessionRun.findUnique({
            where: { id: params.runId },
        });
        if (!run) {
            return null;
        }
        await appendSessionRunEvent({
            tx,
            accountId: params.accountId,
            sessionRunId: run.id,
            type: "cancelled",
            payload: {
                reason: params.reason ?? null,
            },
        });

        const workflow = await upsertIssueWorkflowProjection({
            tx,
            accountId: params.accountId,
            externalIssueRefId: run.externalIssueRefId,
            workflowState: IssueWorkflowState.idle,
            activePrimarySessionId: run.sessionId,
            activePrimaryRunId: null,
            subjectHeadSha: run.headCommitSha ?? null,
            transitionReason: "aborted",
        });
        return toJsonSafe({ run, workflow });
    });
}

export async function expireStaleSessionRuns(params: Readonly<{
    accountId: string;
    machineId: string;
    limit?: number;
}>) {
    return await inTx(async (tx) => {
        const machineOwned = await ensureOwnedMachine(tx, params.accountId, params.machineId);
        if (!machineOwned) {
            return null;
        }

        const now = new Date();
        const staleRuns = await tx.sessionRun.findMany({
            where: {
                accountId: params.accountId,
                state: {
                    in: [SessionRunState.claimed, SessionRunState.running, SessionRunState.waiting_user],
                },
                leaseExpiresAt: { lt: now },
            },
            orderBy: [{ leaseExpiresAt: "asc" }, { createdAt: "asc" }],
            take: params.limit ?? 25,
        });

        const expired = [];
        for (const staleRun of staleRuns) {
            const updated = await tx.sessionRun.updateMany({
                where: {
                    id: staleRun.id,
                    accountId: params.accountId,
                    state: {
                        in: [SessionRunState.claimed, SessionRunState.running, SessionRunState.waiting_user],
                    },
                    leaseExpiresAt: { lt: now },
                },
                data: {
                    state: SessionRunState.expired,
                    finishedAt: now,
                    errorCode: "lease_expired",
                    errorMessage: "Session run lease expired before completion",
                },
            });
            if (updated.count !== 1) {
                continue;
            }

            const run = await tx.sessionRun.findUnique({
                where: { id: staleRun.id },
            });
            if (!run) {
                continue;
            }
            await appendSessionRunEvent({
                tx,
                accountId: params.accountId,
                sessionRunId: run.id,
                type: "expired",
                payload: {
                    expiredByMachineId: params.machineId,
                    previousMachineId: staleRun.claimedByMachineId,
                    leaseExpiresAt: staleRun.leaseExpiresAt?.toISOString() ?? null,
                },
            });
            await clearActiveWorkflowRunIfCurrent({
                tx,
                accountId: params.accountId,
                runId: run.id,
                externalIssueRefId: run.externalIssueRefId,
                sessionId: run.sessionId,
                workflowState: IssueWorkflowState.executing,
                subjectHeadSha: run.headCommitSha ?? null,
                transitionReason: "expired",
            });
            expired.push(run);
        }

        return toJsonSafe(expired);
    });
}
