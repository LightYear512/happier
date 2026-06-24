import { inTx } from "@/storage/inTx";
import { db, ProviderActionState } from "@/storage/db";
import { resolveLeaseExpiresAt } from "@/app/externalIssues/controlPlaneShared";

export async function claimProviderAction(params: Readonly<{
    accountId: string;
    machineId: string;
    leaseDurationMs?: number;
}>) {
    return await inTx(async (tx) => {
        const now = new Date();
        const leaseExpiresAt = resolveLeaseExpiresAt({ now, leaseDurationMs: params.leaseDurationMs });
        const action = await tx.providerActionRequest.findFirst({
            where: {
                accountId: params.accountId,
                state: ProviderActionState.queued,
                OR: [
                    { targetMachineId: null },
                    { targetMachineId: params.machineId },
                ],
            },
            orderBy: [{ createdAt: "asc" }],
        });
        if (!action) {
            return null;
        }

        const updated = await tx.providerActionRequest.updateMany({
            where: {
                id: action.id,
                state: ProviderActionState.queued,
            },
            data: {
                state: ProviderActionState.claimed,
                claimedByExecutorId: params.machineId,
                claimedAt: now,
                leaseExpiresAt,
                attemptCount: { increment: 1 },
                lastAttemptedAt: now,
            },
        });
        if (updated.count !== 1) {
            return null;
        }

        return await tx.providerActionRequest.findUnique({
            where: { id: action.id },
            include: {
                externalIssueRef: {
                    select: {
                        id: true,
                        issueNumber: true,
                        title: true,
                        url: true,
                    },
                },
                repositoryConnection: {
                    select: {
                        id: true,
                        providerBaseUrl: true,
                        authKind: true,
                    },
                },
            },
        });
    });
}

export async function heartbeatProviderAction(params: Readonly<{
    accountId: string;
    actionId: string;
    machineId: string;
    leaseDurationMs?: number;
}>) {
    return await inTx(async (tx) => {
        const leaseExpiresAt = resolveLeaseExpiresAt({ leaseDurationMs: params.leaseDurationMs });
        const updated = await tx.providerActionRequest.updateMany({
            where: {
                id: params.actionId,
                accountId: params.accountId,
                claimedByExecutorId: params.machineId,
                state: {
                    in: [ProviderActionState.claimed, ProviderActionState.running],
                },
            },
            data: {
                leaseExpiresAt,
            },
        });
        if (updated.count !== 1) {
            return null;
        }
        return {
            ok: true,
            leaseExpiresAt,
        };
    });
}

export async function startProviderAction(params: Readonly<{
    accountId: string;
    actionId: string;
    machineId: string;
}>) {
    return await inTx(async (tx) => {
        const now = new Date();
        const updated = await tx.providerActionRequest.updateMany({
            where: {
                id: params.actionId,
                accountId: params.accountId,
                claimedByExecutorId: params.machineId,
                state: ProviderActionState.claimed,
            },
            data: {
                state: ProviderActionState.running,
                startedAt: now,
            },
        });
        if (updated.count !== 1) {
            return null;
        }
        return await tx.providerActionRequest.findUnique({
            where: { id: params.actionId },
        });
    });
}

export async function completeProviderAction(params: Readonly<{
    accountId: string;
    actionId: string;
    machineId: string;
    providerExternalId?: string;
    summary?: string;
}>) {
    return await inTx(async (tx) => {
        const now = new Date();
        const updated = await tx.providerActionRequest.updateMany({
            where: {
                id: params.actionId,
                accountId: params.accountId,
                claimedByExecutorId: params.machineId,
                state: {
                    in: [ProviderActionState.claimed, ProviderActionState.running],
                },
            },
            data: {
                state: ProviderActionState.succeeded,
                finishedAt: now,
                providerExternalId: params.providerExternalId ?? null,
                resultSummary: params.summary ?? null,
            },
        });
        if (updated.count !== 1) {
            return null;
        }
        return await tx.providerActionRequest.findUnique({
            where: { id: params.actionId },
        });
    });
}

export async function failProviderAction(params: Readonly<{
    accountId: string;
    actionId: string;
    machineId: string;
    errorCode?: string;
    errorMessage?: string;
    retryRecommended?: boolean;
}>) {
    return await inTx(async (tx) => {
        const now = new Date();
        const updated = await tx.providerActionRequest.updateMany({
            where: {
                id: params.actionId,
                accountId: params.accountId,
                claimedByExecutorId: params.machineId,
                state: {
                    in: [ProviderActionState.claimed, ProviderActionState.running],
                },
            },
            data: {
                state: params.retryRecommended === true ? ProviderActionState.queued : ProviderActionState.failed,
                finishedAt: params.retryRecommended === true ? null : now,
                lastErrorCode: params.errorCode ?? null,
                lastErrorMessage: params.errorMessage ?? null,
            },
        });
        if (updated.count !== 1) {
            return null;
        }
        return await tx.providerActionRequest.findUnique({
            where: { id: params.actionId },
        });
    });
}
