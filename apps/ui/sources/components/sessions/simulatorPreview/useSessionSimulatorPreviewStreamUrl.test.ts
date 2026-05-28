import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

const serverFetch = vi.hoisted(() => vi.fn());
const getActiveServerSnapshot = vi.hoisted(() => vi.fn(() => ({ serverUrl: 'https://app.happier.test' })));
const useFeatureEnabled = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/sync/http/client', () => ({
    serverFetch,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot,
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled,
}));

describe('useSessionSimulatorPreviewStreamUrl', () => {
    beforeEach(() => {
        serverFetch.mockReset();
        getActiveServerSnapshot.mockReturnValue({ serverUrl: 'https://app.happier.test' });
        useFeatureEnabled.mockReturnValue(true);
    });

    it('resolves simulator streams through the existing preview relay when relay metadata is present', async () => {
        serverFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                token: 'preview_token_1',
                previewUrl: 'https://app.happier.test/preview/sess_1/machine_1/route_android_1/?previewToken=preview_token_1',
                expiresAtMs: 31_000,
                namespaceStrategy: 'path',
            }),
        });
        const { useSessionSimulatorPreviewStreamUrl } = await import('./useSessionSimulatorPreviewStreamUrl');

        const hook = await renderHook(() => useSessionSimulatorPreviewStreamUrl({
            sessionId: 'sess_1',
            directStreamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
            relay: {
                machineId: 'machine_1',
                routeKey: 'route_android_1',
                streamPath: '/stream.mjpeg',
            },
        }));

        expect(serverFetch).toHaveBeenCalledWith(
            '/v1/sessions/sess_1/dev-preview/machine_1/route_android_1/token',
            { method: 'POST' },
        );
        expect(hook.getCurrent().streamUrl).toBe(
            'https://app.happier.test/preview/sess_1/machine_1/route_android_1/stream.mjpeg?previewToken=preview_token_1',
        );
        expect(hook.getCurrent().state).toBe('ready');
    });

    it('falls back to the direct stream URL when relay is unavailable', async () => {
        useFeatureEnabled.mockReturnValueOnce(false);
        const { useSessionSimulatorPreviewStreamUrl } = await import('./useSessionSimulatorPreviewStreamUrl');

        const hook = await renderHook(() => useSessionSimulatorPreviewStreamUrl({
            sessionId: 'sess_1',
            directStreamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
            relay: {
                machineId: 'machine_1',
                routeKey: 'route_android_1',
                streamPath: '/stream.mjpeg',
            },
        }));

        expect(hook.getCurrent().streamUrl).toBe('http://127.0.0.1:9812/stream.mjpeg');
        expect(hook.getCurrent().state).toBe('idle');
    });
});
