import { randomUUID } from "node:crypto";

import { db, IssueWorkflowState, type RepositoryProviderKind, SessionIssueRelation, type SessionRunState } from "@/storage/db";
import { type Tx } from "@/storage/inTx";

const DEFAULT_LEASE_DURATION_MS = 30_000;
const MIN_LEASE_DURATION_MS = 5_000;
const MAX_LEASE_DURATION_MS = 15 * 60_000;
const EXTERNAL_ISSUE_SESSION_TAG_PREFIX = "external-issue";

type UpsertExternalIssueSnapshotParams = Readonly<{
    tx: Tx;
    accountId: string;
    repositoryConnectionId: string;
    provider: RepositoryProviderKind;
    providerBaseUrl: string;
    repositoryKey: string;
    issueNumber: number;
    title?: string;
    state?: string;
    url?: string;
    eventKey?: string | null;
    occurredAt?: Date | null;
    rawSnapshot?: Record<string, unknown>;
    labels?: readonly string[];
    assignees?: readonly string[];
    providerIssueExternalId?: string | null;
}>;

type WorkflowProjectionParams = Readonly<{
    tx: Tx;
    accountId: string;
    externalIssueRefId: string;
    workflowState: typeof IssueWorkflowState[keyof typeof IssueWorkflowState];
    activePrimarySessionId?: string | null;
    activePrimaryRunId?: string | null;
    currentProviderChangeExternalId?: string | null;
    currentProviderChangeUrl?: string | null;
    subjectHeadSha?: string | null;
    transitionReason?: string | null;
}>;

export function resolveLeaseDurationMs(leaseDurationMs?: number): number {
    if (!Number.isFinite(leaseDurationMs)) {
        return DEFAULT_LEASE_DURATION_MS;
    }
    return Math.min(Math.max(Math.floor(leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS), MIN_LEASE_DURATION_MS), MAX_LEASE_DURATION_MS);
}

export function resolveLeaseExpiresAt(params: Readonly<{ now?: Date; leaseDurationMs?: number }>): Date {
    const now = params.now ?? new Date();
    return new Date(now.getTime() + resolveLeaseDurationMs(params.leaseDurationMs));
}

export async function ensureOwnedMachine(tx: Tx, accountId: string, machineId: string): Promise<boolean> {
    const machine = await tx.machine.findFirst({
        where: {
            accountId,
            id: machineId,
        },
        select: { id: true },
    });
    return Boolean(machine);
}

export function normalizeIssueState(state?: string | null): string {
    const normalized = state?.trim().toLowerCase();
    if (!normalized) {
        return "open";
    }
    if (normalized === "opened" || normalized === "reopened") {
        return "open";
    }
    if (normalized === "closed") {
        return "closed";
    }
    return normalized;
}

export function buildProviderIssueUrl(params: Readonly<{
    provider: RepositoryProviderKind;
    providerBaseUrl: string;
    repositoryKey: string;
    issueNumber: number;
}>): string {
    const baseUrl = params.providerBaseUrl.replace(/\/+$/, "");
    if (params.provider === "gitlab") {
        return `${baseUrl}/${params.repositoryKey}/-/issues/${params.issueNumber}`;
    }
    return `${baseUrl}/${params.repositoryKey}/issues/${params.issueNumber}`;
}

export function buildProviderIssueExternalId(params: Readonly<{
    provider: RepositoryProviderKind;
    repositoryKey: string;
    issueNumber: number;
}>): string {
    return `${params.provider}:${params.repositoryKey}#${params.issueNumber}`;
}

export function buildExternalIssueSessionTag(issueNumber: number): string {
    return `${EXTERNAL_ISSUE_SESSION_TAG_PREFIX}-${issueNumber}-${randomUUID()}`;
}

export async function upsertExternalIssueFromSnapshot(params: UpsertExternalIssueSnapshotParams) {
    const now = params.occurredAt ?? new Date();
    const title = params.title?.trim() || `Issue #${params.issueNumber}`;
    const state = normalizeIssueState(params.state);
    const url = params.url?.trim() || buildProviderIssueUrl({
        provider: params.provider,
        providerBaseUrl: params.providerBaseUrl,
        repositoryKey: params.repositoryKey,
        issueNumber: params.issueNumber,
    });
    const providerIssueExternalId = params.providerIssueExternalId?.trim()
        || buildProviderIssueExternalId({
            provider: params.provider,
            repositoryKey: params.repositoryKey,
            issueNumber: params.issueNumber,
        });

    const existing = await params.tx.externalIssueRef.findFirst({
        where: {
            accountId: params.accountId,
            provider: params.provider,
            providerBaseUrl: params.providerBaseUrl,
            repositoryKey: params.repositoryKey,
            issueNumber: params.issueNumber,
        },
    });

    if (existing) {
        return await params.tx.externalIssueRef.update({
            where: { id: existing.id },
            data: {
                repositoryConnectionId: params.repositoryConnectionId,
                title,
                state,
                url,
                labels: [...(params.labels ?? [])],
                assignees: [...(params.assignees ?? [])],
                lastEventKey: params.eventKey ?? existing.lastEventKey,
                lastEventAt: params.occurredAt ?? existing.lastEventAt,
                rawSnapshot: { ...(params.rawSnapshot ?? {}) },
                syncedAt: now,
                providerIssueExternalId,
            },
        });
    }

    return await params.tx.externalIssueRef.create({
        data: {
            accountId: params.accountId,
            repositoryConnectionId: params.repositoryConnectionId,
            provider: params.provider,
            providerBaseUrl: params.providerBaseUrl,
            repositoryKey: params.repositoryKey,
            providerIssueExternalId,
            issueNumber: params.issueNumber,
            title,
            state,
            labels: [...(params.labels ?? [])],
            assignees: [...(params.assignees ?? [])],
            url,
            lastEventKey: params.eventKey ?? null,
            lastEventAt: params.occurredAt ?? null,
            rawSnapshot: { ...(params.rawSnapshot ?? {}) },
            syncedAt: now,
        },
    });
}

export async function upsertIssueWorkflowProjection(params: WorkflowProjectionParams) {
    const existing = await params.tx.issueExecutionProjection.findUnique({
        where: { externalIssueRefId: params.externalIssueRefId },
    });

    if (existing) {
        return await params.tx.issueExecutionProjection.update({
            where: { externalIssueRefId: params.externalIssueRefId },
            data: {
                workflowState: params.workflowState,
                activePrimarySessionId: params.activePrimarySessionId ?? null,
                activePrimaryRunId: params.activePrimaryRunId ?? null,
                currentProviderChangeExternalId: params.currentProviderChangeExternalId ?? null,
                currentProviderChangeUrl: params.currentProviderChangeUrl ?? null,
                subjectHeadSha: params.subjectHeadSha ?? null,
                transitionReason: params.transitionReason ?? null,
            },
        });
    }

    return await params.tx.issueExecutionProjection.create({
        data: {
            accountId: params.accountId,
            externalIssueRefId: params.externalIssueRefId,
            workflowState: params.workflowState,
            activePrimarySessionId: params.activePrimarySessionId ?? null,
            activePrimaryRunId: params.activePrimaryRunId ?? null,
            currentProviderChangeExternalId: params.currentProviderChangeExternalId ?? null,
            currentProviderChangeUrl: params.currentProviderChangeUrl ?? null,
            subjectHeadSha: params.subjectHeadSha ?? null,
            transitionReason: params.transitionReason ?? null,
        },
    });
}

export async function getIssueWorkflowOrDefault(accountId: string, externalIssueRefId: string) {
    const workflow = await db.issueExecutionProjection.findUnique({
        where: { externalIssueRefId },
    });

    if (workflow) {
        return workflow;
    }

    return {
        id: `workflow:${externalIssueRefId}`,
        accountId,
        externalIssueRefId,
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

export async function ensurePrimaryIssueSessionLink(params: Readonly<{
    tx: Tx;
    accountId: string;
    sessionId: string;
    externalIssueRefId: string;
}>): Promise<void> {
    const existing = await params.tx.sessionIssueLink.findFirst({
        where: {
            accountId: params.accountId,
            sessionId: params.sessionId,
            externalIssueRefId: params.externalIssueRefId,
            relation: SessionIssueRelation.primary,
            active: true,
        },
        select: { id: true },
    });

    if (existing) {
        return;
    }

    await params.tx.sessionIssueLink.create({
        data: {
            accountId: params.accountId,
            sessionId: params.sessionId,
            externalIssueRefId: params.externalIssueRefId,
            relation: SessionIssueRelation.primary,
            active: true,
        },
    });
}

export function isClaimableRunState(state: SessionRunState, leaseExpiresAt: Date | null, now: Date): boolean {
    if (state === "queued") {
        return true;
    }
    if (state !== "claimed" && state !== "running" && state !== "waiting_user") {
        return false;
    }
    if (!leaseExpiresAt) {
        return false;
    }
    return leaseExpiresAt.getTime() < now.getTime();
}
