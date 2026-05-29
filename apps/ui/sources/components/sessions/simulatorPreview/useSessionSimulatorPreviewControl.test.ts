import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook } from '@/dev/testkit';

const sessionRpcWithServerScope = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', () => ({
    sessionRpcWithServerScope,
}));

describe('useSessionSimulatorPreviewControl', () => {
    beforeEach(() => {
        sessionRpcWithServerScope.mockReset();
    });

    it('acquires a user lease and forwards simulator input through session RPC', async () => {
        sessionRpcWithServerScope
            .mockResolvedValueOnce({
                ok: true,
                leaseId: 'lease_user_1',
                generation: 1,
                owner: 'user',
                expiresAtMs: 31_000,
            })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true });
        const { useSessionSimulatorPreviewControl } = await import('./useSessionSimulatorPreviewControl');

        const hook = await renderHook(() => useSessionSimulatorPreviewControl({
            sessionId: 'sess_1',
            simulatorSessionId: 'sim_android_1',
        }));

        await act(async () => {
            await hook.getCurrent().requestControl();
        });
        await hook.getCurrent().sendInput({
            simulatorSessionId: 'sim_android_1',
            leaseId: 'lease_user_1',
            generation: 1,
            owner: 'user',
            input: { type: 'tap', x: 0.5, y: 0.25 },
        });
        await hook.getCurrent().sendInput({
            simulatorSessionId: 'sim_android_1',
            leaseId: 'lease_user_1',
            generation: 1,
            owner: 'user',
            input: { type: 'text', text: 'hello world' },
        });
        await hook.getCurrent().reloadApp();
        await hook.getCurrent().reconnectDevServices();
        await act(async () => {
            await hook.getCurrent().releaseControl();
        });

        expect(sessionRpcWithServerScope).toHaveBeenNthCalledWith(1, {
            sessionId: 'sess_1',
            method: 'session.simulatorPreview.control.acquire',
            payload: {
                simulatorSessionId: 'sim_android_1',
                owner: 'user',
                holderId: 'happier-ui',
                leaseTtlMs: 30_000,
            },
        });
        expect(sessionRpcWithServerScope).toHaveBeenNthCalledWith(2, {
            sessionId: 'sess_1',
            method: 'session.simulatorPreview.input.send',
            payload: {
                simulatorSessionId: 'sim_android_1',
                leaseId: 'lease_user_1',
                generation: 1,
                owner: 'user',
                input: { type: 'tap', x: 0.5, y: 0.25 },
            },
        });
        expect(sessionRpcWithServerScope).toHaveBeenNthCalledWith(3, {
            sessionId: 'sess_1',
            method: 'session.simulatorPreview.input.send',
            payload: {
                simulatorSessionId: 'sim_android_1',
                leaseId: 'lease_user_1',
                generation: 1,
                owner: 'user',
                input: { type: 'text', text: 'hello world' },
            },
        });
        expect(sessionRpcWithServerScope).toHaveBeenNthCalledWith(4, {
            sessionId: 'sess_1',
            method: 'session.simulatorPreview.app.reload',
            payload: {
                simulatorSessionId: 'sim_android_1',
                leaseId: 'lease_user_1',
                generation: 1,
                owner: 'user',
                holderId: 'happier-ui',
            },
        });
        expect(sessionRpcWithServerScope).toHaveBeenNthCalledWith(5, {
            sessionId: 'sess_1',
            method: 'session.simulatorPreview.devServices.reconnect',
            payload: {
                simulatorSessionId: 'sim_android_1',
                leaseId: 'lease_user_1',
                generation: 1,
                owner: 'user',
                holderId: 'happier-ui',
            },
        });
        expect(sessionRpcWithServerScope).toHaveBeenNthCalledWith(6, {
            sessionId: 'sess_1',
            method: 'session.simulatorPreview.control.release',
            payload: {
                simulatorSessionId: 'sim_android_1',
                leaseId: 'lease_user_1',
                owner: 'user',
                holderId: 'happier-ui',
            },
        });
        expect(hook.getCurrent().controlLease).toBeNull();
    });

    it('keeps the active lease when release is rejected', async () => {
        sessionRpcWithServerScope
            .mockResolvedValueOnce({
                ok: true,
                leaseId: 'lease_user_1',
                generation: 1,
                owner: 'user',
                expiresAtMs: 31_000,
            })
            .mockResolvedValueOnce({
                ok: false,
                errorCode: 'lease_owner_mismatch',
                error: 'lease_owner_mismatch',
            });
        const { useSessionSimulatorPreviewControl } = await import('./useSessionSimulatorPreviewControl');

        const hook = await renderHook(() => useSessionSimulatorPreviewControl({
            sessionId: 'sess_1',
            simulatorSessionId: 'sim_android_1',
        }));

        await act(async () => {
            await hook.getCurrent().requestControl();
        });
        await act(async () => {
            await hook.getCurrent().releaseControl();
        });

        expect(hook.getCurrent().controlLease).toEqual(expect.objectContaining({
            leaseId: 'lease_user_1',
            generation: 1,
            owner: 'user',
        }));
    });
});
