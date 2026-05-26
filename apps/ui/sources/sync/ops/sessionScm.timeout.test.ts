import { describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const machineRpcWithServerScopeMock = vi.fn();
const getStateSpy = vi.fn();

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpcWithServerScopeMock,
}));

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
    storage: {
        getState: () => getStateSpy(),
    },
});
});

describe('sessionScm (rpc timeouts)', () => {
    it('uses an extended machine RPC timeout for commit diffs', async () => {
        const { sessionScmDiffCommit } = await import('./sessionScm');

        getStateSpy.mockReturnValue({
            settings: {
                scmGitRepoPreferredBackend: null,
            },
            sessions: {
                s1: {
                    active: true,
                    metadata: {
                        machineId: 'm1',
                        path: '/repo',
                    },
                },
            },
            machines: {
                m1: {
                    id: 'm1',
                    active: true,
                    activeAt: 1,
                    metadata: {},
                },
            },
        });

        machineRpcWithServerScopeMock.mockResolvedValue({
            success: true,
            diff: 'diff --git a/a.txt b/a.txt',
        });

        await sessionScmDiffCommit('s1', { cwd: '.', commit: 'abc' });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            machineId: 'm1',
            method: RPC_METHODS.SCM_DIFF_COMMIT,
            payload: {
                cwd: '/repo',
                commit: 'abc',
            },
            timeoutMs: 120_000,
        });
    });
});
