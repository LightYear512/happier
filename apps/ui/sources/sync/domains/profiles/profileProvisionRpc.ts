import type { SwitchProfileEvent } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

export type { SwitchProfileEvent };

export type ProfileProvisionBackendId = 'claude' | 'codex';

export type ProfileProvisionResult =
    | Readonly<{
        type: 'success';
        profileDir: string;
        alreadyProvisioned: boolean;
        ptyOutput: string;
    }>
    | Readonly<{
        type: 'error';
        errorCode?: string;
        errorMessage?: string;
        ptyOutput?: string;
    }>;

export type ProfileProvisionProgressSnapshot = Readonly<{
    output: string;
    completed: boolean;
}>;

export type SessionSwitchProfileResult =
    | Readonly<{
        type: 'success';
        events?: SwitchProfileEvent[];
    }>
    | Readonly<{
        type: 'error';
        errorCode?: string;
        errorMessage?: string;
        events?: SwitchProfileEvent[];
    }>;

type ProfileProvisionRpcParams = Readonly<{
    profileId: string;
    backendId: ProfileProvisionBackendId;
    machineId: string;
}>;

export async function callProfileProvision(params: ProfileProvisionRpcParams): Promise<ProfileProvisionResult> {
    return await machineRpcWithServerScope<ProfileProvisionResult, Readonly<{
        profileId: string;
        backendId: ProfileProvisionBackendId;
    }>>({
        method: RPC_METHODS.PROFILE_PROVISION,
        machineId: params.machineId,
        payload: {
            profileId: params.profileId,
            backendId: params.backendId,
        },
    });
}

export async function callProfileProvisionProgress(
    params: ProfileProvisionRpcParams,
): Promise<ProfileProvisionProgressSnapshot> {
    return await machineRpcWithServerScope<ProfileProvisionProgressSnapshot, Readonly<{
        profileId: string;
        backendId: ProfileProvisionBackendId;
    }>>({
        method: RPC_METHODS.PROFILE_PROVISION_POLL_PROGRESS,
        machineId: params.machineId,
        payload: {
            profileId: params.profileId,
            backendId: params.backendId,
        },
    });
}

export async function callSessionSwitchProfile(params: Readonly<{
    sessionId: string;
    targetProfileId: string;
    machineId: string;
}>): Promise<SessionSwitchProfileResult> {
    return await machineRpcWithServerScope<SessionSwitchProfileResult, Readonly<{
        sessionId: string;
        targetProfileId: string;
    }>>({
        method: RPC_METHODS.SESSION_SWITCH_PROFILE,
        machineId: params.machineId,
        payload: {
            sessionId: params.sessionId,
            targetProfileId: params.targetProfileId,
        },
    });
}
