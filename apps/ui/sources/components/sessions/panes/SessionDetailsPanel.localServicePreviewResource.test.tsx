import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const relayFeatureState = vi.hoisted(() => ({
    enabled: false,
}));
const serverFetchSpy = vi.hoisted(() => vi.fn());
const setDetailsTabStateSpy = vi.hoisted(() => vi.fn());
const detailsTabState = vi.hoisted(() => ({
    value: {} as Record<string, unknown>,
}));
const activeServerSnapshotState = vi.hoisted(() => ({
    serverUrl: 'https://proxyapi.layaair.com',
    serverId: 'server_1',
    generation: 1,
}));

function installWindow(href: string) {
    const url = new URL(href);
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            location: {
                href: url.href,
                origin: url.origin,
                protocol: url.protocol,
                hostname: url.hostname,
            },
        },
    });
}

installSessionDetailsPanelCommonModuleMocks({
    storage: async (importOriginal) => {
        const {
            createStorageModuleMock,
            createUseLocalSettingMock,
            createUseLocalSettingMutableMock,
        } = await import('@/dev/testkit/mocks/storage');
        const useLocalSetting = createUseLocalSettingMock();
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useLocalSetting,
                useLocalSettingMutable: createUseLocalSettingMutableMock(useLocalSetting),
            },
        });
    },
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));

vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}) },
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => featureId === 'sessions.devPreview.relay' ? relayFeatureState.enabled : false,
}));

vi.mock('@/sync/http/client', () => ({
    serverFetch: (...args: unknown[]) => serverFetchSpy(...args),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => activeServerSnapshotState,
}));

vi.mock('@/components/sessions/files/views/SessionCommitDetailsView', () => ({
    SessionCommitDetailsView: () => React.createElement('SessionCommitDetailsView'),
}));

vi.mock('@/components/sessions/files/views/SessionFileDetailsView', () => ({
    SessionFileDetailsView: () => React.createElement('SessionFileDetailsView'),
}));

vi.mock('@/components/sessions/files/views/SessionScmReviewDetailsView', () => ({
    SessionScmReviewDetailsView: () => React.createElement('SessionScmReviewDetailsView'),
}));

vi.mock('@/components/sessions/terminal/SessionEmbeddedTerminalPane', () => ({
    SessionEmbeddedTerminalPane: () => React.createElement('SessionEmbeddedTerminalPane'),
}));

vi.mock('@/components/appShell/panes/hooks/useAppPaneScope', () => ({
    useAppPaneScope: () => ({
        closeDetails: vi.fn(),
        closeDetailsTab: vi.fn(),
        pinDetailsTab: vi.fn(),
        setDetailsTabState: setDetailsTabStateSpy,
        setActiveDetailsTab: vi.fn(),
        scopeState: {
            details: {
                isOpen: true,
                activeTabKey: 'localServicePreview:preview_1',
                tabState: detailsTabState.value,
                tabs: [
                    {
                        key: 'localServicePreview:preview_1',
                        kind: 'localServicePreview',
                        title: 'Preview app',
                        subtitle: 'http://127.0.0.1:3000',
                        isPinned: true,
                        isPreview: false,
                        resource: {
                            kind: 'localServicePreview',
                            resourceId: 'preview_1',
                            sessionId: 's1',
                            machineId: 'machine-1',
                            port: 3000,
                            routeKey: 'route_1',
                            initialPath: '/dashboard',
                            rewriteUrls: true,
                            supportsWebSocket: true,
                            healthStatus: 'ready',
                            name: 'Preview app',
                        },
                    },
                ],
            },
        },
    }),
}));

describe('SessionDetailsPanel (local service preview resource)', () => {
    beforeEach(() => {
        delete (globalThis as { window?: unknown }).window;
        relayFeatureState.enabled = false;
        detailsTabState.value = {};
        activeServerSnapshotState.serverUrl = 'https://proxyapi.layaair.com';
        setDetailsTabStateSpy.mockReset();
        serverFetchSpy.mockReset();
        serverFetchSpy.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                token: 'preview_token_1',
                previewUrl: 'https://preview-route.example.test/?previewToken=preview_token_1',
                namespaceStrategy: 'host',
            }),
        });
    });

    it('renders a same-machine iframe preview for loopback web origins', async () => {
        installWindow('http://localhost:8081/session/s1');
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');

        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);

        expect(screen.getTextContent()).toContain('Preview app');
        expect(screen.findByTestId('session-details-tab-unpin-localServicePreview_preview_1')).toBeTruthy();
        expect(screen.findByTestId('session-details-tab-pin-localServicePreview_preview_1')).toBeNull();
        expect(screen.findByTestId('session-details-tab-close-localServicePreview_preview_1')).toBeTruthy();
        expect(screen.getTextContent()).toContain('http://127.0.0.1:3000');
        expect(screen.getTextContent()).not.toContain('machine-1');
        expect(screen.getTextContent()).not.toContain('ready');
        const iframe = screen.findByType('iframe');
        expect(iframe.props.src).toBe('http://127.0.0.1:3000/dashboard');
        expect(iframe.props['data-testid']).toBe('session.localServicePreview.iframe');
        expect(screen.getTextContent()).not.toContain('common.unavailable');
        expect(String(iframe.props.src)).not.toContain('route_1');
        expect(screen.findAllByType('ActivityIndicator')).toHaveLength(0);
        expect(serverFetchSpy).not.toHaveBeenCalled();
    });

    it('prefers a server-routed iframe preview for loopback web origins when relay is enabled', async () => {
        installWindow('http://localhost:8081/session/s1');
        relayFeatureState.enabled = true;
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');

        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);
        await flushHookEffects({ cycles: 1, turns: 2 });

        const iframe = screen.findByType('iframe');
        expect(String(iframe.props.src)).toBe('https://preview-route.example.test/dashboard?previewToken=preview_token_1');
        expect(String(iframe.props.src)).not.toContain('127.0.0.1:3000');
        expect(iframe.props.sandbox).toContain('allow-same-origin');
        expect(setDetailsTabStateSpy).toHaveBeenCalledWith(
            'localServicePreview:preview_1',
            { previewDisplayUrl: 'https://preview-route.example.test/dashboard' },
        );
        expect(serverFetchSpy).toHaveBeenCalledWith(
            '/v1/sessions/s1/dev-preview/machine-1/route_1/token',
            { method: 'POST' },
        );
    });

    it('falls back to same-machine loopback preview when relay resolution fails', async () => {
        installWindow('http://localhost:8081/session/s1');
        relayFeatureState.enabled = true;
        serverFetchSpy.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');

        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);
        await flushHookEffects({ cycles: 1, turns: 2 });

        const iframe = screen.findByType('iframe');
        expect(iframe.props.src).toBe('http://127.0.0.1:3000/dashboard');
        expect(iframe.props.sandbox).toBeUndefined();
        expect(screen.getTextContent()).toContain('http://127.0.0.1:3000');
        expect(serverFetchSpy).toHaveBeenCalledWith(
            '/v1/sessions/s1/dev-preview/machine-1/route_1/token',
            { method: 'POST' },
        );
    });

    it('renders a server-routed iframe preview for host-namespaced remote web origins when relay is enabled', async () => {
        installWindow('https://proxyapi.layaair.com/session/s1');
        relayFeatureState.enabled = true;
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');

        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);
        await flushHookEffects({ cycles: 1, turns: 2 });

        expect(screen.getTextContent()).toContain('Preview app');
        expect(screen.getTextContent()).toContain('http://127.0.0.1:3000');
        expect(screen.getTextContent()).not.toContain('machine-1');
        expect(screen.getTextContent()).not.toContain('ready');
        const iframe = screen.findByType('iframe');
        expect(String(iframe.props.src)).toBe('https://preview-route.example.test/dashboard?previewToken=preview_token_1');
        expect(String(iframe.props.src)).toContain('previewToken=preview_token_1');
        expect(String(iframe.props.src)).not.toContain('3000');
        expect(setDetailsTabStateSpy).toHaveBeenCalledWith(
            'localServicePreview:preview_1',
            { previewDisplayUrl: 'https://preview-route.example.test/dashboard' },
        );
        expect(iframe.props['data-testid']).toBe('session.localServicePreview.iframe');
        expect(iframe.props.sandbox).toContain('allow-scripts');
        expect(iframe.props.sandbox).toContain('allow-same-origin');
        expect(screen.getTextContent()).not.toContain('common.unavailable');
        expect(serverFetchSpy).toHaveBeenCalledWith(
            '/v1/sessions/s1/dev-preview/machine-1/route_1/token',
            { method: 'POST' },
        );
    });

    it('shows the resolved relay preview URL in the preview tab subtitle when available', async () => {
        installWindow('https://proxyapi.layaair.com/session/s1');
        relayFeatureState.enabled = true;
        detailsTabState.value = {
            'localServicePreview:preview_1': {
                previewDisplayUrl: 'https://preview-route.example.test/dashboard',
            },
        };
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');

        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);

        expect(screen.getTextContent()).toContain('Preview app');
        expect(screen.getTextContent()).toContain('https://preview-route.example.test/dashboard');
        expect(screen.getTextContent()).not.toContain('previewToken=preview_token_1');
        expect(screen.getTextContent()).not.toContain('http://127.0.0.1:3000');
    });

    it('does not repeatedly write preview tab state when the parent rerenders after resolving the relay URL', async () => {
        installWindow('https://proxyapi.layaair.com/session/s1');
        relayFeatureState.enabled = true;
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');

        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);
        await flushHookEffects({ cycles: 1, turns: 2 });
        expect(setDetailsTabStateSpy).toHaveBeenCalledWith(
            'localServicePreview:preview_1',
            { previewDisplayUrl: 'https://preview-route.example.test/dashboard' },
        );

        setDetailsTabStateSpy.mockClear();
        await act(async () => {
            screen.tree.update(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" showHeaderActions={false} />);
        });
        await flushHookEffects({ cycles: 1, turns: 2 });

        expect(setDetailsTabStateSpy).not.toHaveBeenCalled();
    });

    it('keeps path-namespaced remote previews in an opaque iframe sandbox', async () => {
        installWindow('https://proxyapi.layaair.com/session/s1');
        relayFeatureState.enabled = true;
        serverFetchSpy.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                token: 'preview_token_1',
                previewUrl: 'https://proxyapi.layaair.com/preview/s1/machine-1/route_1/?previewToken=preview_token_1',
                namespaceStrategy: 'path',
            }),
        });
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');

        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);
        await flushHookEffects({ cycles: 1, turns: 2 });

        const iframe = screen.findByType('iframe');
        expect(String(iframe.props.src)).toBe('https://proxyapi.layaair.com/preview/s1/machine-1/route_1/dashboard?previewToken=preview_token_1');
        expect(iframe.props.sandbox).toContain('allow-scripts');
        expect(iframe.props.sandbox).not.toContain('allow-same-origin');
    });

    it('uses the server-provided preview URL without requiring an app-derived relay base URL', async () => {
        installWindow('https://proxyapi.layaair.com/session/s1');
        relayFeatureState.enabled = true;
        activeServerSnapshotState.serverUrl = 'not a url';
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');

        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);
        await flushHookEffects({ cycles: 1, turns: 2 });

        const iframe = screen.findByType('iframe');
        expect(String(iframe.props.src)).toBe('https://preview-route.example.test/dashboard?previewToken=preview_token_1');
        expect(serverFetchSpy).toHaveBeenCalledWith(
            '/v1/sessions/s1/dev-preview/machine-1/route_1/token',
            { method: 'POST' },
        );
    });

    it('keeps remote web origins in the unavailable state when relay is disabled', async () => {
        installWindow('https://proxyapi.layaair.com/session/s1');
        const { SessionDetailsPanel } = await import('./SessionDetailsPanel');

        const screen = await renderScreen(<SessionDetailsPanel sessionId="s1" scopeId="session:s1" />);

        expect(screen.getTextContent()).toContain('Preview app');
        expect(screen.getTextContent()).toContain('http://127.0.0.1:3000');
        expect(screen.getTextContent()).not.toContain('machine-1');
        expect(screen.getTextContent()).not.toContain('ready');
        expect(screen.getTextContent()).toContain('common.unavailable');
        expect(screen.findAllByType('iframe')).toHaveLength(0);
        expect(serverFetchSpy).not.toHaveBeenCalled();
    });
});
