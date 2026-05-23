import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const machineRpcWithServerScopeMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (...args: unknown[]) => machineRpcWithServerScopeMock(...args),
}));

describe('profileProvisionRpc', () => {
    beforeEach(() => {
        machineRpcWithServerScopeMock.mockReset();
    });

    it('calls profile provision through scoped machine RPC', async () => {
        machineRpcWithServerScopeMock.mockResolvedValue({
            type: 'success',
            profileDir: '/tmp/profile',
            alreadyProvisioned: false,
            ptyOutput: 'ok',
            profileAuthSessionId: 'auth-1',
            terminalKey: 'profile-login:machine-1:claude:work',
        });
        const { callProfileProvision } = await import('./profileProvisionRpc');

        const result = await callProfileProvision({
            profileId: 'work',
            backendId: 'claude',
            machineId: 'machine-1',
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            method: RPC_METHODS.PROFILE_PROVISION,
            machineId: 'machine-1',
            payload: {
                profileId: 'work',
                backendId: 'claude',
                machineId: 'machine-1',
            },
        });
        expect(result).toEqual(expect.objectContaining({ type: 'success', profileDir: '/tmp/profile' }));
    });

    it('polls provision progress through scoped machine RPC', async () => {
        machineRpcWithServerScopeMock.mockResolvedValue({ output: 'login url', completed: false });
        const { callProfileProvisionProgress } = await import('./profileProvisionRpc');

        const result = await callProfileProvisionProgress({
            profileId: 'work',
            backendId: 'codex',
            machineId: 'machine-1',
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            method: RPC_METHODS.PROFILE_PROVISION_POLL_PROGRESS,
            machineId: 'machine-1',
            payload: {
                profileId: 'work',
                backendId: 'codex',
                machineId: 'machine-1',
            },
        });
        expect(result).toEqual({ output: 'login url', completed: false });
    });

    it('verifies profile provision without preparing another terminal session', async () => {
        machineRpcWithServerScopeMock.mockResolvedValue({
            type: 'success',
            profileDir: '/tmp/profile',
            alreadyProvisioned: true,
            ptyOutput: '',
            profileAuthSessionId: null,
            terminalKey: 'profile-login:machine-1:claude:work',
        });
        const { callProfileProvisionVerify } = await import('./profileProvisionRpc');

        const result = await callProfileProvisionVerify({
            profileId: 'work',
            backendId: 'claude',
            machineId: 'machine-1',
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            method: RPC_METHODS.PROFILE_PROVISION,
            machineId: 'machine-1',
            payload: {
                profileId: 'work',
                backendId: 'claude',
                machineId: 'machine-1',
                verifyOnly: true,
            },
        });
        expect(result).toEqual(expect.objectContaining({ type: 'success', alreadyProvisioned: true }));
    });


    it('calls session switch through scoped machine RPC', async () => {
        machineRpcWithServerScopeMock.mockResolvedValue({
            type: 'success',
            events: [
                { type: 'switch_pending', targetProfileId: 'work' },
                { type: 'switch_complete', targetProfileId: 'work' },
            ],
        });
        const { callSessionSwitchProfile } = await import('./profileProvisionRpc');

        const result = await callSessionSwitchProfile({
            sessionId: 'session-1',
            targetProfileId: 'work',
            machineId: 'machine-1',
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            method: RPC_METHODS.SESSION_SWITCH_PROFILE,
            machineId: 'machine-1',
            payload: {
                sessionId: 'session-1',
                targetProfileId: 'work',
            },
        });
        expect(result.type).toBe('success');
        expect(result.events?.map((event) => event.type)).toEqual(['switch_pending', 'switch_complete']);
    });
});
