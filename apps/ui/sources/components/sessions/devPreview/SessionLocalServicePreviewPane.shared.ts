import * as React from 'react';
import { Platform } from 'react-native';
import { SessionDevPreviewTokenResponseSchema } from '@happier-dev/protocol';

import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { serverFetch } from '@/sync/http/client';

const LOOPBACK_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '0:0:0:0:0:0:0:1']);

export type SessionLocalServicePreviewPaneProps = Readonly<{
    scopeId: string;
    resourceId: string;
    sessionId: string;
    machineId: string;
    port: number;
    initialPath?: string;
    routeKey: string;
    rewriteUrls: boolean;
    supportsWebSocket: boolean;
    name?: string;
    healthStatus?: string;
    onPreviewUrlChange?: (previewUrl: string | null) => void;
}>;

export type SessionLocalServicePreviewRelayState = 'idle' | 'loading' | 'ready' | 'error';
export type SessionLocalServicePreviewNamespaceStrategy = 'host' | 'path';

export function normalizePreviewHostname(hostname: string): string {
    const lowered = hostname.trim().toLowerCase();
    if (lowered.startsWith('[') && lowered.endsWith(']')) {
        return lowered.slice(1, -1);
    }
    return lowered;
}

function resolveSameMachinePreviewUrl(port: number): string | null {
    if (Platform.OS !== 'web') {
        return null;
    }

    const location = globalThis.window?.location;
    const rawLocation =
        typeof location?.href === 'string' && location.href.trim().length > 0
            ? location.href
            : typeof location?.origin === 'string'
                ? location.origin
                : '';
    if (!rawLocation) {
        return null;
    }

    try {
        const currentUrl = new URL(rawLocation);
        if (currentUrl.protocol !== 'http:') {
            return null;
        }
        if (!LOOPBACK_HTTP_HOSTS.has(normalizePreviewHostname(currentUrl.hostname))) {
            return null;
        }
        return `http://127.0.0.1:${port}/`;
    } catch {
        return null;
    }
}

export function applyInitialPreviewPath(baseUrl: string, initialPath?: string): string {
    const normalizedPath = typeof initialPath === 'string' && initialPath.startsWith('/') && !initialPath.startsWith('//')
        ? initialPath
        : '/';
    if (normalizedPath === '/') {
        return baseUrl;
    }
    try {
        const url = new URL(baseUrl);
        const basePath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
        url.pathname = `${basePath}${normalizedPath.slice(1)}`;
        return url.toString();
    } catch {
        return baseUrl;
    }
}

function resolveLoadablePreviewUrl(baseUrl: string, initialPath?: string): string | null {
    try {
        const url = new URL(applyInitialPreviewPath(baseUrl, initialPath));
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        return url.toString();
    } catch {
        return null;
    }
}

function isLocalhostNamespacePreviewUrl(previewUrl: string): boolean {
    try {
        const hostname = normalizePreviewHostname(new URL(previewUrl).hostname);
        return hostname === 'localhost' || hostname.endsWith('.localhost');
    } catch {
        return false;
    }
}

function resolveNativeHostNamespaceLoadUrl(params: Readonly<{
    previewUrl: string;
    previewToken: string;
    fallbackBaseUrl: string | null;
    initialPath?: string;
}>): string | null {
    if (Platform.OS === 'web' || !isLocalhostNamespacePreviewUrl(params.previewUrl)) {
        return resolveLoadablePreviewUrl(params.previewUrl, params.initialPath);
    }
    if (!params.fallbackBaseUrl) {
        return null;
    }
    try {
        const url = new URL(params.fallbackBaseUrl);
        url.searchParams.set('previewToken', params.previewToken);
        return resolveLoadablePreviewUrl(url.toString(), params.initialPath);
    } catch {
        return null;
    }
}

function sanitizePreviewDisplayUrl(previewUrl: string | null): string | null {
    if (!previewUrl) {
        return null;
    }
    try {
        const url = new URL(previewUrl);
        url.searchParams.delete('previewToken');
        return url.toString();
    } catch {
        return null;
    }
}

function resolveRelayPreviewBaseUrl(params: Readonly<{
    sessionId: string;
    machineId: string;
    routeKey: string;
}>): string | null {
    try {
        const snapshot = getActiveServerSnapshot();
        const baseUrl = new URL(snapshot.serverUrl);
        const previewUrl = new URL(
            `/preview/${encodeURIComponent(params.sessionId)}/${encodeURIComponent(params.machineId)}/${encodeURIComponent(params.routeKey)}/`,
            baseUrl,
        );
        return previewUrl.toString();
    } catch {
        return null;
    }
}

function buildPreviewRouteBasePath(params: Readonly<{
    sessionId: string;
    machineId: string;
    routeKey: string;
}>): string {
    return `/preview/${encodeURIComponent(params.sessionId)}/${encodeURIComponent(params.machineId)}/${encodeURIComponent(params.routeKey)}/`;
}

function isWithinPathNamespacePreviewRoute(params: Readonly<{
    nextUrl: URL;
    routeBasePath: string;
}>): boolean {
    const routeBasePath = params.routeBasePath.endsWith('/') ? params.routeBasePath : `${params.routeBasePath}/`;
    return params.nextUrl.pathname === routeBasePath.slice(0, -1) || params.nextUrl.pathname.startsWith(routeBasePath);
}

export function isAllowedNativePreviewNavigation(params: Readonly<{
    previewUrl: string;
    nextUrl: string;
    namespaceStrategy: SessionLocalServicePreviewNamespaceStrategy | null;
    routeBasePath: string;
}>): boolean {
    try {
        const preview = new URL(params.previewUrl);
        const next = new URL(params.nextUrl, preview);
        const sameOrigin = preview.protocol === next.protocol
            && normalizePreviewHostname(preview.hostname) === normalizePreviewHostname(next.hostname)
            && preview.port === next.port;
        if (!sameOrigin) {
            return false;
        }
        if (params.namespaceStrategy !== 'path') {
            return true;
        }
        return isWithinPathNamespacePreviewRoute({
            nextUrl: next,
            routeBasePath: params.routeBasePath,
        });
    } catch {
        return false;
    }
}

export function shouldOpenExternalNativePreviewNavigation(nextUrl: string): boolean {
    try {
        const url = new URL(nextUrl);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

export function useSessionLocalServicePreviewResolution(
    props: SessionLocalServicePreviewPaneProps,
    options: Readonly<{ sameMachinePreviewEnabled: boolean }>,
) {
    const iframeTitle = typeof props.name === 'string' && props.name.trim().length > 0
        ? props.name.trim()
        : `127.0.0.1:${props.port}`;
    const relayEnabled = useFeatureEnabled('sessions.devPreview.relay');
    const sameMachinePreviewUrl = React.useMemo(
        () => {
            if (!options.sameMachinePreviewEnabled) return null;
            const url = resolveSameMachinePreviewUrl(props.port);
            return url ? resolveLoadablePreviewUrl(url, props.initialPath) : null;
        },
        [options.sameMachinePreviewEnabled, props.initialPath, props.port],
    );
    const relayPreviewFallbackBaseUrl = React.useMemo(
        () => resolveRelayPreviewBaseUrl({
            sessionId: props.sessionId,
            machineId: props.machineId,
            routeKey: props.routeKey,
        }),
        [props.machineId, props.routeKey, props.sessionId],
    );
    const [relayPreviewUrl, setRelayPreviewUrl] = React.useState<string | null>(null);
    const [relayPreviewDisplayUrl, setRelayPreviewDisplayUrl] = React.useState<string | null>(null);
    const [relayNamespaceStrategy, setRelayNamespaceStrategy] = React.useState<SessionLocalServicePreviewNamespaceStrategy | null>(null);
    const [relayState, setRelayState] = React.useState<SessionLocalServicePreviewRelayState>('idle');
    const onPreviewUrlChangeRef = React.useRef(props.onPreviewUrlChange);

    React.useEffect(() => {
        onPreviewUrlChangeRef.current = props.onPreviewUrlChange;
    }, [props.onPreviewUrlChange]);

    React.useEffect(() => {
        if (!relayEnabled) {
            setRelayPreviewUrl(null);
            setRelayPreviewDisplayUrl(null);
            setRelayNamespaceStrategy(null);
            setRelayState('idle');
            return;
        }

        let cancelled = false;
        setRelayState('loading');
        setRelayPreviewUrl(null);
        setRelayPreviewDisplayUrl(null);
        setRelayNamespaceStrategy(null);

        void serverFetch(
            `/v1/sessions/${encodeURIComponent(props.sessionId)}/dev-preview/${encodeURIComponent(props.machineId)}/${encodeURIComponent(props.routeKey)}/token`,
            { method: 'POST' },
        )
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`preview token request failed: ${response.status}`);
                }
                const payload = await response.json();
                const parsed = SessionDevPreviewTokenResponseSchema.safeParse(payload);
                if (!parsed.success) {
                    throw new Error('invalid preview token payload');
                }
                if (cancelled) {
                    return;
                }
                const previewUrl = typeof parsed.data.previewUrl === 'string' && parsed.data.previewUrl.trim().length > 0
                    ? parsed.data.previewUrl.trim()
                    : (() => {
                        if (!relayPreviewFallbackBaseUrl) {
                            throw new Error('missing relay preview URL');
                        }
                        const url = new URL(relayPreviewFallbackBaseUrl);
                        url.searchParams.set('previewToken', parsed.data.token);
                        return url.toString();
                    })();
                const responseNamespaceStrategy = parsed.data.namespaceStrategy === 'host' ? 'host' : 'path';
                const loadablePreviewUrl = responseNamespaceStrategy === 'host'
                    ? resolveNativeHostNamespaceLoadUrl({
                        previewUrl,
                        previewToken: parsed.data.token,
                        fallbackBaseUrl: relayPreviewFallbackBaseUrl,
                        initialPath: props.initialPath,
                    })
                    : resolveLoadablePreviewUrl(previewUrl, props.initialPath);
                if (!loadablePreviewUrl) {
                    throw new Error('invalid preview URL');
                }
                const displayPreviewUrl = resolveLoadablePreviewUrl(previewUrl, props.initialPath);
                setRelayPreviewUrl(loadablePreviewUrl);
                setRelayPreviewDisplayUrl(displayPreviewUrl ?? loadablePreviewUrl);
                setRelayNamespaceStrategy(loadablePreviewUrl === displayPreviewUrl ? responseNamespaceStrategy : 'path');
                setRelayState('ready');
            })
            .catch(() => {
                if (cancelled) {
                    return;
                }
                setRelayPreviewUrl(null);
                setRelayPreviewDisplayUrl(null);
                setRelayNamespaceStrategy(null);
                setRelayState('error');
            });

        return () => {
            cancelled = true;
        };
    }, [props.initialPath, props.machineId, props.routeKey, props.sessionId, relayEnabled, relayPreviewFallbackBaseUrl]);

    const shouldUseSameMachineFallback = !relayEnabled || relayState === 'error';
    const previewUrl = relayPreviewUrl ?? (shouldUseSameMachineFallback ? sameMachinePreviewUrl : null);
    const previewDisplayUrl = relayPreviewDisplayUrl ?? relayPreviewUrl ?? (shouldUseSameMachineFallback ? sameMachinePreviewUrl : null);
    React.useEffect(() => {
        onPreviewUrlChangeRef.current?.(sanitizePreviewDisplayUrl(previewDisplayUrl));
    }, [previewDisplayUrl]);

    return {
        iframeTitle,
        previewUrl,
        previewRouteBasePath: buildPreviewRouteBasePath(props),
        relayNamespaceStrategy,
        relayState,
        sameMachinePreviewUrl,
    };
}
