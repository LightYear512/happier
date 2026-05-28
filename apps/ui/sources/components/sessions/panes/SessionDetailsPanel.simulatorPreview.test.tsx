import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sessionRpcWithServerScope = vi.hoisted(() => vi.fn());
const serverFetch = vi.hoisted(() => vi.fn());
const getActiveServerSnapshot = vi.hoisted(() => vi.fn(() => ({ serverUrl: 'https://app.happier.test' })));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', () => ({
    sessionRpcWithServerScope,
}));

vi.mock('@/sync/http/client', () => ({
    serverFetch,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot,
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => true,
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));

vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}) },
}));

installSessionDetailsPanelCommonModuleMocks({
    icons: async () => ({
        Octicons: 'Octicons',
        Ionicons: 'Ionicons',
    }),
});

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        closeDetails: vi.fn(),
        closeDetailsTab: vi.fn(),
        pinDetailsTab: vi.fn(),
        unpinDetailsTab: vi.fn(),
        setActiveDetailsTab: vi.fn(),
        openDetailsTab: vi.fn(),
        setDetailsTabState: vi.fn(),
        scopeState: {
            details: {
                isOpen: true,
                activeTabKey: 'simulatorPreview:sim_1',
                tabState: {},
                tabs: [
                    {
                        key: 'simulatorPreview:sim_1',
                        kind: 'simulatorPreview',
                        title: 'Pixel 8',
                        isPinned: false,
                        isPreview: true,
                        resource: {
                            kind: 'simulatorPreview',
                            simulatorSessionId: 'sim_1',
                            platform: 'android',
                            deviceName: 'Pixel 8',
                            appName: 'Happier',
                            streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
                            mode: 'user_control',
                            owner: 'user',
                            connectionPath: 'relay',
                            relay: {
                                machineId: 'machine_1',
                                routeKey: 'route_android_1',
                                streamPath: '/stream.mjpeg',
                            },
                        },
                    },
                ],
            },
        },
    }),
}));

vi.mock('@/components/sessions/terminal/SessionEmbeddedTerminalPane', () => ({
    SessionEmbeddedTerminalPane: () => React.createElement('SessionEmbeddedTerminalPane'),
}));

vi.mock('@/components/sessions/files/views/SessionCommitDetailsView', () => ({
    SessionCommitDetailsView: () => React.createElement('SessionCommitDetailsView'),
}));

vi.mock('@/components/sessions/files/views/SessionFileDetailsView', () => ({
    SessionFileDetailsView: () => React.createElement('SessionFileDetailsView'),
}));

describe('SessionDetailsPanel (simulator preview)', () => {
    beforeEach(() => {
        sessionRpcWithServerScope.mockReset();
        serverFetch.mockReset();
        getActiveServerSnapshot.mockReturnValue({ serverUrl: 'https://app.happier.test' });
        serverFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                token: 'preview_token_1',
                previewUrl: 'https://app.happier.test/preview/s1/machine_1/route_android_1/?previewToken=preview_token_1',
                expiresAtMs: 31_000,
                namespaceStrategy: 'path',
            }),
        });
    });

    it('renders the simulator frame inside a details tab', async () => {
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');
        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);

        const frame = screen.findByProps({ 'data-testid': 'session.simulatorPreview.frame' });

        expect(frame.props.src).toBe('https://app.happier.test/preview/s1/machine_1/route_android_1/stream.mjpeg?previewToken=preview_token_1');
        expect(screen.findByProps({ testID: 'session.simulatorPreview.surface' })).toBeTruthy();
    });

    it('acquires user control from the details tab and forwards viewport taps through session RPC', async () => {
        sessionRpcWithServerScope
            .mockResolvedValueOnce({
                ok: true,
                leaseId: 'lease_user_1',
                generation: 1,
                owner: 'user',
                expiresAtMs: 31_000,
            })
            .mockResolvedValueOnce({ ok: true });
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');
        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);

        await screen.pressByTestIdAsync('session.simulatorPreview.requestControl');

        const viewport = screen.findByProps({ testID: 'session.simulatorPreview.screenViewport' });
        await act(async () => {
            viewport.props.onLayout({
                nativeEvent: {
                    layout: {
                        x: 0,
                        y: 0,
                        width: 200,
                        height: 400,
                    },
                },
            });
            await viewport.props.onPress({
                nativeEvent: {
                    locationX: 100,
                    locationY: 200,
                },
            });
        });

        expect(sessionRpcWithServerScope).toHaveBeenNthCalledWith(1, {
            sessionId: 's1',
            method: 'session.simulatorPreview.control.acquire',
            payload: {
                simulatorSessionId: 'sim_1',
                owner: 'user',
                holderId: 'happier-ui',
                leaseTtlMs: 30_000,
            },
        });
        expect(sessionRpcWithServerScope).toHaveBeenNthCalledWith(2, {
            sessionId: 's1',
            method: 'session.simulatorPreview.input.send',
            payload: {
                simulatorSessionId: 'sim_1',
                leaseId: 'lease_user_1',
                generation: 1,
                owner: 'user',
                input: {
                    type: 'tap',
                    x: 0.5,
                    y: 0.5,
                },
            },
        });
    });
});
