import { inTx } from "@/storage/inTx";
import {
    db,
    type RepositoryAuthKind,
    type RepositoryConnectionMode,
    type RepositoryProviderKind,
} from "@/storage/db";
import {
    ensureOwnedMachine,
    resolveLeaseExpiresAt,
    upsertExternalIssueFromSnapshot,
} from "@/app/externalIssues/controlPlaneShared";
import { ensureAutomatedSessionRunForIssue } from "@/app/sessionRuns/sessionRunService";

type ConnectionFilters = Readonly<{
    provider?: RepositoryProviderKind;
    mode?: RepositoryConnectionMode;
    enabled?: boolean;
    repositoryKey?: string;
}>;

type CreateRepositoryConnectionParams = Readonly<{
    accountId: string;
    provider: RepositoryProviderKind;
    providerBaseUrl: string;
    repositoryKey: string;
    mode: RepositoryConnectionMode;
    authKind: RepositoryAuthKind;
    pollerEnabled?: boolean;
    pollingOwnerMachineId?: string | null;
}>;

type VerificationPolicyParams = Readonly<{
    accountId: string;
    connectionId: string;
    requiresRemoteCi: boolean;
    allowsLocalVerifyFallback: boolean;
    autoMergeEligible: boolean;
    blockingSuites?: readonly string[];
    localVerifyCommands?: readonly string[];
}>;

type PollEventInput = Readonly<{
    eventKey: string;
    occurredAt: number;
    kind: string;
    issueNumber?: number;
    providerChangeExternalId?: string;
    headCommitSha?: string;
    command?: string;
    snapshot?: Record<string, unknown>;
}>;

type PollLeaseClaimResult =
    | Readonly<{ ok: true; connection: NonNullable<Awaited<ReturnType<typeof getRepositoryConnection>>> }>
    | Readonly<{ ok: false; error: "not_found" | "poll_lease_conflict" }>;

type PushPolledEventsResult =
    | Readonly<{
        ok: true;
        recorded: number;
        deduped: number;
        issues: Awaited<ReturnType<typeof upsertExternalIssueFromSnapshot>>[];
    }>
    | Readonly<{ ok: false; error: "not_found" | "poll_lease_required" }>;

export async function listRepositoryConnections(accountId: string, filters: ConnectionFilters) {
    return await db.repositoryConnection.findMany({
        where: {
            accountId,
            provider: filters.provider,
            mode: filters.mode,
            enabled: filters.enabled,
            repositoryKey: filters.repositoryKey,
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
}

export async function upsertRepositoryConnection(params: CreateRepositoryConnectionParams) {
    return await inTx(async (tx) => {
        const existing = await tx.repositoryConnection.findFirst({
            where: {
                accountId: params.accountId,
                provider: params.provider,
                providerBaseUrl: params.providerBaseUrl,
                repositoryKey: params.repositoryKey,
            },
        });

        if (existing) {
            return await tx.repositoryConnection.update({
                where: { id: existing.id },
                data: {
                    mode: params.mode,
                    authKind: params.authKind,
                    enabled: true,
                    pollerEnabled: params.pollerEnabled ?? existing.pollerEnabled,
                    pollingOwnerMachineId: params.pollingOwnerMachineId ?? existing.pollingOwnerMachineId,
                },
            });
        }

        return await tx.repositoryConnection.create({
            data: {
                accountId: params.accountId,
                provider: params.provider,
                providerBaseUrl: params.providerBaseUrl,
                repositoryKey: params.repositoryKey,
                mode: params.mode,
                authKind: params.authKind,
                enabled: true,
                pollerEnabled: params.pollerEnabled ?? false,
                pollingOwnerMachineId: params.pollingOwnerMachineId ?? null,
                capabilities: {},
            },
        });
    });
}

export async function getRepositoryConnection(accountId: string, connectionId: string) {
    return await db.repositoryConnection.findFirst({
        where: {
            id: connectionId,
            accountId,
        },
    });
}

export async function refreshRepositoryConnectionCapabilities(accountId: string, connectionId: string) {
    return await db.repositoryConnection.updateMany({
        where: {
            id: connectionId,
            accountId,
        },
        data: {
            lastCapabilitySyncAt: new Date(),
        },
    }).then(async (updated) => {
        if (updated.count !== 1) {
            return null;
        }
        return await getRepositoryConnection(accountId, connectionId);
    });
}

function asJsonRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
}

export async function bindRepositoryLocalCheckout(params: Readonly<{
    accountId: string;
    connectionId: string;
    machineId: string;
    localCheckoutPath: string;
}>) {
    return await inTx(async (tx) => {
        const machineOwned = await ensureOwnedMachine(tx, params.accountId, params.machineId);
        if (!machineOwned) {
            return null;
        }

        const connection = await tx.repositoryConnection.findFirst({
            where: {
                id: params.connectionId,
                accountId: params.accountId,
            },
            select: {
                id: true,
                capabilities: true,
            },
        });
        if (!connection) {
            return null;
        }

        await tx.repositoryConnection.update({
            where: { id: connection.id },
            data: {
                capabilities: {
                    ...asJsonRecord(connection.capabilities),
                    localCheckoutPath: params.localCheckoutPath,
                    localCheckoutMachineId: params.machineId,
                    localCheckoutUpdatedAt: new Date().toISOString(),
                },
                lastCapabilitySyncAt: new Date(),
            },
        });

        return await tx.repositoryConnection.findUnique({
            where: { id: connection.id },
        });
    });
}

export async function getVerificationPolicy(accountId: string, connectionId: string) {
    return await db.verificationPolicy.findFirst({
        where: {
            accountId,
            repositoryConnectionId: connectionId,
        },
    });
}

export async function upsertVerificationPolicy(params: VerificationPolicyParams) {
    return await inTx(async (tx) => {
        const connection = await tx.repositoryConnection.findFirst({
            where: {
                id: params.connectionId,
                accountId: params.accountId,
            },
        });
        if (!connection) {
            return null;
        }

        const existing = await tx.verificationPolicy.findFirst({
            where: {
                accountId: params.accountId,
                repositoryConnectionId: params.connectionId,
            },
        });

        if (existing) {
            return await tx.verificationPolicy.update({
                where: { id: existing.id },
                data: {
                    repositoryKey: connection.repositoryKey,
                    requiresRemoteCi: params.requiresRemoteCi,
                    allowsLocalVerifyFallback: params.allowsLocalVerifyFallback,
                    autoMergeEligible: params.autoMergeEligible,
                    blockingSuites: [...(params.blockingSuites ?? [])],
                    localVerifyCommands: [...(params.localVerifyCommands ?? [])],
                },
            });
        }

        return await tx.verificationPolicy.create({
            data: {
                accountId: params.accountId,
                repositoryConnectionId: connection.id,
                repositoryKey: connection.repositoryKey,
                requiresRemoteCi: params.requiresRemoteCi,
                allowsLocalVerifyFallback: params.allowsLocalVerifyFallback,
                autoMergeEligible: params.autoMergeEligible,
                blockingSuites: [...(params.blockingSuites ?? [])],
                localVerifyCommands: [...(params.localVerifyCommands ?? [])],
            },
        });
    });
}

export async function claimRepositoryPollLease(params: Readonly<{
    accountId: string;
    connectionId: string;
    machineId: string;
    leaseDurationMs?: number;
}>): Promise<PollLeaseClaimResult> {
    return await inTx(async (tx) => {
        const machineOwned = await ensureOwnedMachine(tx, params.accountId, params.machineId);
        if (!machineOwned) {
            return { ok: false, error: "not_found" };
        }

        const now = new Date();
        const leaseExpiresAt = resolveLeaseExpiresAt({ now, leaseDurationMs: params.leaseDurationMs });
        const updated = await tx.repositoryConnection.updateMany({
            where: {
                id: params.connectionId,
                accountId: params.accountId,
                OR: [
                    { pollingOwnerMachineId: null },
                    { pollingOwnerMachineId: params.machineId },
                    { pollingLeaseExpiresAt: null },
                    { pollingLeaseExpiresAt: { lt: now } },
                ],
            },
            data: {
                pollerEnabled: true,
                pollingOwnerMachineId: params.machineId,
                pollingLeaseExpiresAt: leaseExpiresAt,
            },
        });
        if (updated.count !== 1) {
            const connection = await tx.repositoryConnection.findFirst({
                where: {
                    id: params.connectionId,
                    accountId: params.accountId,
                },
                select: {
                    pollingOwnerMachineId: true,
                    pollingLeaseExpiresAt: true,
                },
            });
            if (!connection) {
                return { ok: false, error: "not_found" };
            }
            if (
                connection.pollingOwnerMachineId
                && connection.pollingOwnerMachineId !== params.machineId
                && connection.pollingLeaseExpiresAt
                && connection.pollingLeaseExpiresAt.getTime() >= now.getTime()
            ) {
                return { ok: false, error: "poll_lease_conflict" };
            }
            return { ok: false, error: "not_found" };
        }

        const connection = await tx.repositoryConnection.findUnique({
            where: { id: params.connectionId },
        });
        return connection
            ? { ok: true, connection }
            : { ok: false, error: "not_found" };
    });
}

export async function heartbeatRepositoryPollLease(params: Readonly<{
    accountId: string;
    connectionId: string;
    machineId: string;
    leaseDurationMs?: number;
    capabilities?: Record<string, unknown>;
}>) {
    return await inTx(async (tx) => {
        const leaseExpiresAt = resolveLeaseExpiresAt({ leaseDurationMs: params.leaseDurationMs });
        const updated = await tx.repositoryConnection.updateMany({
            where: {
                id: params.connectionId,
                accountId: params.accountId,
                pollingOwnerMachineId: params.machineId,
            },
            data: {
                pollingLeaseExpiresAt: leaseExpiresAt,
                remoteCiDetected: params.capabilities?.remoteCiDetected === true,
                webhookEnabled: params.capabilities?.webhookEnabled === true,
                capabilities: { ...(params.capabilities ?? {}) },
                lastCapabilitySyncAt: new Date(),
            },
        });
        if (updated.count !== 1) {
            return null;
        }

        return await tx.repositoryConnection.findUnique({
            where: { id: params.connectionId },
        });
    });
}

export async function pushPolledEvents(params: Readonly<{
    accountId: string;
    connectionId: string;
    machineId: string;
    events: readonly PollEventInput[];
}>): Promise<PushPolledEventsResult> {
    return await inTx(async (tx) => {
        const machineOwned = await ensureOwnedMachine(tx, params.accountId, params.machineId);
        if (!machineOwned) {
            return { ok: false, error: "not_found" };
        }

        const now = new Date();
        const connection = await tx.repositoryConnection.findFirst({
            where: {
                id: params.connectionId,
                accountId: params.accountId,
            },
        });
        if (!connection) {
            return { ok: false, error: "not_found" };
        }
        if (
            connection.pollingOwnerMachineId !== params.machineId
            || !connection.pollingLeaseExpiresAt
            || connection.pollingLeaseExpiresAt.getTime() < now.getTime()
        ) {
            return { ok: false, error: "poll_lease_required" };
        }

        let recorded = 0;
        let deduped = 0;
        const touchedIssues = new Map<string, Awaited<ReturnType<typeof upsertExternalIssueFromSnapshot>>>();

        for (const event of params.events) {
            const receiptKey = `poll:${event.eventKey}`;
            const existingReceipt = await tx.providerEventReceipt.findFirst({
                where: {
                    repositoryConnectionId: connection.id,
                    receiptKey,
                },
                select: { id: true },
            });
            if (existingReceipt) {
                if (typeof event.issueNumber === "number") {
                    const existingIssue = await tx.externalIssueRef.findFirst({
                        where: {
                            accountId: params.accountId,
                            repositoryConnectionId: connection.id,
                            issueNumber: event.issueNumber,
                        },
                    });
                    if (existingIssue) {
                        touchedIssues.set(existingIssue.id, existingIssue);
                    }
                }
                deduped += 1;
                continue;
            }

            recorded += 1;
            let issueId: string | null = null;
            if (typeof event.issueNumber === "number") {
                const issue = await upsertExternalIssueFromSnapshot({
                    tx,
                    accountId: params.accountId,
                    repositoryConnectionId: connection.id,
                    provider: connection.provider,
                    providerBaseUrl: connection.providerBaseUrl,
                    repositoryKey: connection.repositoryKey,
                    issueNumber: event.issueNumber,
                    title: typeof event.snapshot?.title === "string" ? event.snapshot.title : undefined,
                    state: typeof event.snapshot?.state === "string" ? event.snapshot.state : undefined,
                    url: typeof event.snapshot?.url === "string" ? event.snapshot.url : undefined,
                    eventKey: event.eventKey,
                    occurredAt: new Date(event.occurredAt),
                    rawSnapshot: event.snapshot,
                });
                touchedIssues.set(issue.id, issue);
                issueId = issue.id;
                await ensureAutomatedSessionRunForIssue({
                    tx,
                    accountId: params.accountId,
                    issueRefId: issue.id,
                    triggerKind: "poll_event",
                    idempotencyKey: receiptKey,
                });
            }

            await tx.providerEventReceipt.create({
                data: {
                    accountId: params.accountId,
                    repositoryConnectionId: connection.id,
                    externalIssueRefId: issueId,
                    provider: connection.provider,
                    receiptKey,
                    eventKind: event.kind,
                },
            });
        }

        return {
            ok: true,
            recorded,
            deduped,
            issues: [...touchedIssues.values()],
        };
    });
}
