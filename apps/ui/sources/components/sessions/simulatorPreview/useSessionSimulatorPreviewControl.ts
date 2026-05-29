import * as React from 'react';

import { sessionRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc';

import type { SessionSimulatorPreviewPaneProps } from './SessionSimulatorPreviewPane';

type ControlLease = NonNullable<SessionSimulatorPreviewPaneProps['controlLease']>;
type SimulatorInput = Parameters<NonNullable<SessionSimulatorPreviewPaneProps['onSendInput']>>[0];

const SIMULATOR_PREVIEW_SESSION_RPC_METHODS = {
    CONTROL_ACQUIRE: 'session.simulatorPreview.control.acquire',
    CONTROL_RELEASE: 'session.simulatorPreview.control.release',
    INPUT_SEND: 'session.simulatorPreview.input.send',
} as const;

function isControlLease(value: unknown): value is ControlLease {
    if (!value || typeof value !== 'object') return false;
    const maybe = value as Record<string, unknown>;
    return typeof maybe.leaseId === 'string'
        && typeof maybe.generation === 'number'
        && maybe.owner === 'user';
}

function shouldClearLeaseAfterReleaseResult(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const maybe = value as Record<string, unknown>;
    if (maybe.ok === true) return true;
    return maybe.ok === false
        && (
            maybe.errorCode === 'lease_not_found'
            || maybe.errorCode === 'invalid_lease'
            || maybe.errorCode === 'lease_expired'
        );
}

export function useSessionSimulatorPreviewControl(params: Readonly<{
    sessionId: string;
    simulatorSessionId: string;
}>) {
    const [controlLease, setControlLease] = React.useState<ControlLease | null>(null);

    const requestControl = React.useCallback(async () => {
        const result = await sessionRpcWithServerScope<unknown, unknown>({
            sessionId: params.sessionId,
            method: SIMULATOR_PREVIEW_SESSION_RPC_METHODS.CONTROL_ACQUIRE,
            payload: {
                simulatorSessionId: params.simulatorSessionId,
                owner: 'user',
                holderId: 'happier-ui',
                leaseTtlMs: 30_000,
            },
        });
        if (isControlLease(result)) {
            setControlLease(result);
        }
        return result;
    }, [params.sessionId, params.simulatorSessionId]);

    const sendInput = React.useCallback(async (input: SimulatorInput) => {
        return await sessionRpcWithServerScope<unknown, unknown>({
            sessionId: params.sessionId,
            method: SIMULATOR_PREVIEW_SESSION_RPC_METHODS.INPUT_SEND,
            payload: input,
        });
    }, [params.sessionId]);

    const releaseControl = React.useCallback(async () => {
        if (!controlLease) return null;
        const result = await sessionRpcWithServerScope<unknown, unknown>({
            sessionId: params.sessionId,
            method: SIMULATOR_PREVIEW_SESSION_RPC_METHODS.CONTROL_RELEASE,
            payload: {
                simulatorSessionId: params.simulatorSessionId,
                leaseId: controlLease.leaseId,
                owner: controlLease.owner,
                holderId: 'happier-ui',
            },
        });
        if (shouldClearLeaseAfterReleaseResult(result)) {
            setControlLease(null);
        }
        return result;
    }, [controlLease, params.sessionId, params.simulatorSessionId]);

    return {
        controlLease,
        requestControl,
        releaseControl,
        sendInput,
    };
}
