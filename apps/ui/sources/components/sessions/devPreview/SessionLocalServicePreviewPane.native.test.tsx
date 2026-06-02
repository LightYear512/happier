import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { flushHookEffects, renderScreen } from '@/dev/testkit';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const relayFeatureState = vi.hoisted(() => ({
    enabled: true,
}));
const activeServerSnapshotState = vi.hoisted(() => ({
    serverUrl: 'https://proxyapi.layaair.com',
}));
const serverFetchSpy = vi.hoisted(() => vi.fn());
const onPreviewUrlChangeSpy = vi.hoisted(() => vi.fn());
const linkingOpenUrlSpy = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            OS: 'ios',
            select: <T,>(options: { web?: T; default?: T; native?: T; ios?: T; android?: T }) =>
                options?.ios ?? options?.native ?? options?.default ?? options?.web ?? options?.android,
        },
        Linking: {
            openURL: linkingOpenUrlSpy,
        },
    });
});

vi.mock('react-native-webview', () => ({
    WebView: (props: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('WebView', props, props.children),
}));

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => featureId === 'sessions.devPreview.relay' ? relayFeatureState.enabled : false,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({
        serverUrl: activeServerSnapshotState.serverUrl,
        serverId: 'server_1',
        generation: 1,
    }),
}));

vi.mock('@/sync/http/client', () => ({
    serverFetch: (...args: unknown[]) => serverFetchSpy(...args),
}));

describe('SessionLocalServicePreviewPane (native)', () => {
    beforeEach(() => {
        relayFeatureState.enabled = true;
        activeServerSnapshotState.serverUrl = 'https://proxyapi.layaair.com';
        linkingOpenUrlSpy.mockClear();
        onPreviewUrlChangeSpy.mockReset();
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

    it('loads the server-provided relay preview URL in a native WebView', async () => {
        const { SessionLocalServicePreviewPane } = await import('./SessionLocalServicePreviewPane.native');

        const screen = await renderScreen(
            <SessionLocalServicePreviewPane
                scopeId="session:s1"
                resourceId="preview_1"
                sessionId="s1"
                machineId="machine-1"
                port={3000}
                initialPath="/dashboard"
                routeKey="route_1"
                rewriteUrls
                supportsWebSocket
                name="Preview app"
                healthStatus="ready"
                onPreviewUrlChange={onPreviewUrlChangeSpy}
            />,
        );
        await flushHookEffects({ cycles: 1, turns: 2 });

        expect(serverFetchSpy).toHaveBeenCalledWith(
            '/v1/sessions/s1/dev-preview/machine-1/route_1/token',
            { method: 'POST' },
        );
        const webView = screen.findByType('WebView' as React.ElementType);
        expect(webView.props.source).toEqual({
            uri: 'https://preview-route.example.test/dashboard?previewToken=preview_token_1',
        });
        expect(webView.props.testID).toBe('session.localServicePreview.webview');
        expect(onPreviewUrlChangeSpy).toHaveBeenCalledWith('https://preview-route.example.test/dashboard');
        expect(screen.getTextContent()).not.toContain('common.unavailable');
    });

    it('loads localhost host-namespace relay previews through the path namespace on native platforms', async () => {
        activeServerSnapshotState.serverUrl = 'http://127.0.0.1:32214';
        serverFetchSpy.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                token: 'preview_token_1',
                previewUrl: 'http://hp-route.hpo-server.localhost:32214/?previewToken=preview_token_1',
                namespaceStrategy: 'host',
            }),
        });
        const { SessionLocalServicePreviewPane } = await import('./SessionLocalServicePreviewPane.native');

        const screen = await renderScreen(
            <SessionLocalServicePreviewPane
                scopeId="session:s1"
                resourceId="preview_1"
                sessionId="s1"
                machineId="machine-1"
                port={3000}
                initialPath="/dashboard"
                routeKey="route_1"
                rewriteUrls
                supportsWebSocket
                name="Preview app"
                healthStatus="ready"
                onPreviewUrlChange={onPreviewUrlChangeSpy}
            />,
        );
        await flushHookEffects({ cycles: 1, turns: 2 });

        const webView = screen.findByType('WebView' as React.ElementType);
        expect(webView.props.source).toEqual({
            uri: 'http://127.0.0.1:32214/preview/s1/machine-1/route_1/dashboard?previewToken=preview_token_1',
        });
        expect(webView.props.originWhitelist).toEqual(['http://127.0.0.1:32214']);
        expect(onPreviewUrlChangeSpy).toHaveBeenCalledWith('http://hp-route.hpo-server.localhost:32214/dashboard');
    });

    it('does not use same-machine loopback fallback on native platforms', async () => {
        const { SessionLocalServicePreviewPane } = await import('./SessionLocalServicePreviewPane.native');

        const screen = await renderScreen(
            <SessionLocalServicePreviewPane
                scopeId="session:s1"
                resourceId="preview_1"
                sessionId="s1"
                machineId="machine-1"
                port={3000}
                initialPath="/dashboard"
                routeKey="route_1"
                rewriteUrls
                supportsWebSocket
            />,
        );
        await flushHookEffects({ cycles: 1, turns: 2 });

        const webView = screen.findByType('WebView' as React.ElementType);
        expect(String(webView.props.source.uri)).not.toContain('127.0.0.1:3000');
        expect(serverFetchSpy).toHaveBeenCalledTimes(1);
    });

    it('opens off-origin native preview navigation outside the WebView', async () => {
        const { SessionLocalServicePreviewPane } = await import('./SessionLocalServicePreviewPane.native');

        const screen = await renderScreen(
            <SessionLocalServicePreviewPane
                scopeId="session:s1"
                resourceId="preview_1"
                sessionId="s1"
                machineId="machine-1"
                port={3000}
                routeKey="route_1"
                rewriteUrls
                supportsWebSocket
            />,
        );
        await flushHookEffects({ cycles: 1, turns: 2 });

        const webView = screen.findByType('WebView' as React.ElementType);
        const shouldStart = webView.props.onShouldStartLoadWithRequest as (request: { url: string }) => boolean;
        expect(shouldStart({ url: 'https://docs.example.test/guide' })).toBe(false);
        expect(linkingOpenUrlSpy).toHaveBeenCalledWith('https://docs.example.test/guide');
    });

    it('blocks path-namespace native preview navigation outside the preview route', async () => {
        serverFetchSpy.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                token: 'preview_token_1',
                previewUrl: 'https://proxyapi.layaair.com/preview/s1/machine-1/route_1/?previewToken=preview_token_1',
                namespaceStrategy: 'path',
            }),
        });
        const { SessionLocalServicePreviewPane } = await import('./SessionLocalServicePreviewPane.native');

        const screen = await renderScreen(
            <SessionLocalServicePreviewPane
                scopeId="session:s1"
                resourceId="preview_1"
                sessionId="s1"
                machineId="machine-1"
                port={3000}
                routeKey="route_1"
                rewriteUrls
                supportsWebSocket
            />,
        );
        await flushHookEffects({ cycles: 1, turns: 2 });

        const webView = screen.findByType('WebView' as React.ElementType);
        const shouldStart = webView.props.onShouldStartLoadWithRequest as (request: { url: string }) => boolean;
        expect(shouldStart({ url: 'https://proxyapi.layaair.com/preview/s1/machine-1/route_1/settings' })).toBe(true);
        expect(shouldStart({ url: 'https://proxyapi.layaair.com/settings' })).toBe(false);
        expect(linkingOpenUrlSpy).toHaveBeenCalledWith('https://proxyapi.layaair.com/settings');
    });

    it('blocks unsafe off-origin native preview navigation without opening it externally', async () => {
        const { SessionLocalServicePreviewPane } = await import('./SessionLocalServicePreviewPane.native');

        const screen = await renderScreen(
            <SessionLocalServicePreviewPane
                scopeId="session:s1"
                resourceId="preview_1"
                sessionId="s1"
                machineId="machine-1"
                port={3000}
                routeKey="route_1"
                rewriteUrls
                supportsWebSocket
            />,
        );
        await flushHookEffects({ cycles: 1, turns: 2 });

        const webView = screen.findByType('WebView' as React.ElementType);
        const shouldStart = webView.props.onShouldStartLoadWithRequest as (request: { url: string }) => boolean;
        expect(shouldStart({ url: 'javascript:alert(1)' })).toBe(false);
        expect(linkingOpenUrlSpy).not.toHaveBeenCalled();
    });

    it('keeps native preview unavailable when the server returns an invalid preview URL', async () => {
        serverFetchSpy.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                token: 'preview_token_1',
                previewUrl: 'not a url',
                namespaceStrategy: 'host',
            }),
        });
        const { SessionLocalServicePreviewPane } = await import('./SessionLocalServicePreviewPane.native');

        const screen = await renderScreen(
            <SessionLocalServicePreviewPane
                scopeId="session:s1"
                resourceId="preview_1"
                sessionId="s1"
                machineId="machine-1"
                port={3000}
                routeKey="route_1"
                rewriteUrls
                supportsWebSocket
                onPreviewUrlChange={onPreviewUrlChangeSpy}
            />,
        );
        await flushHookEffects({ cycles: 1, turns: 2 });

        expect(screen.findAllByType('WebView' as React.ElementType)).toHaveLength(0);
        expect(screen.getTextContent()).toContain('Unavailable');
        expect(onPreviewUrlChangeSpy).toHaveBeenLastCalledWith(null);
    });

    it('shows the unavailable state when the native WebView load fails', async () => {
        const { SessionLocalServicePreviewPane } = await import('./SessionLocalServicePreviewPane.native');

        const screen = await renderScreen(
            <SessionLocalServicePreviewPane
                scopeId="session:s1"
                resourceId="preview_1"
                sessionId="s1"
                machineId="machine-1"
                port={3000}
                routeKey="route_1"
                rewriteUrls
                supportsWebSocket
            />,
        );
        await flushHookEffects({ cycles: 1, turns: 2 });

        const webView = screen.findByType('WebView' as React.ElementType);
        await act(async () => {
            webView.props.onError?.({ nativeEvent: { description: 'TLS handshake failed' } });
        });

        expect(screen.findAllByType('WebView' as React.ElementType)).toHaveLength(0);
        expect(screen.getTextContent()).toContain('Unavailable');
    });

    it('keeps the native WebView mounted when a subresource returns an HTTP error', async () => {
        const { SessionLocalServicePreviewPane } = await import('./SessionLocalServicePreviewPane.native');

        const screen = await renderScreen(
            <SessionLocalServicePreviewPane
                scopeId="session:s1"
                resourceId="preview_1"
                sessionId="s1"
                machineId="machine-1"
                port={3000}
                routeKey="route_1"
                rewriteUrls
                supportsWebSocket
            />,
        );
        await flushHookEffects({ cycles: 1, turns: 2 });

        const webView = screen.findByType('WebView' as React.ElementType);
        await act(async () => {
            webView.props.onHttpError?.({
                nativeEvent: {
                    statusCode: 404,
                    url: 'https://preview-route.example.test/favicon.ico',
                },
            });
        });

        expect(screen.findAllByType('WebView' as React.ElementType)).toHaveLength(1);
        expect(screen.getTextContent()).not.toContain('Unavailable');
    });
});
