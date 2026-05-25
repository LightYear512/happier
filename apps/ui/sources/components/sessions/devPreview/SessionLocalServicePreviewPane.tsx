import React from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { SessionDevPreviewTokenResponseSchema } from '@happier-dev/protocol';

import { Text } from '@/components/ui/text/Text';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { serverFetch } from '@/sync/http/client';
import { t } from '@/text';

const LOOPBACK_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '0:0:0:0:0:0:0:1']);

function normalizeHostname(hostname: string): string {
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
        if (!LOOPBACK_HTTP_HOSTS.has(normalizeHostname(currentUrl.hostname))) {
            return null;
        }
        return `http://127.0.0.1:${port}/`;
    } catch {
        return null;
    }
}

function applyInitialPreviewPath(baseUrl: string, initialPath?: string): string {
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

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
        minHeight: 0,
        minWidth: 0,
    },
    previewFrameContainer: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
    },
    secondary: {
        color: theme.colors.text.secondary,
        fontSize: 12,
    },
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    unavailable: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
}));

export function SessionLocalServicePreviewPane(props: Readonly<{
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
}>) {
    const iframeTitle = typeof props.name === 'string' && props.name.trim().length > 0
        ? props.name.trim()
        : `127.0.0.1:${props.port}`;
    const relayEnabled = useFeatureEnabled('sessions.devPreview.relay');
    const sameMachinePreviewUrl = React.useMemo(
        () => {
            const url = resolveSameMachinePreviewUrl(props.port);
            return url ? applyInitialPreviewPath(url, props.initialPath) : null;
        },
        [props.initialPath, props.port],
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
    const [relayNamespaceStrategy, setRelayNamespaceStrategy] = React.useState<'host' | 'path' | null>(null);
    const [relayState, setRelayState] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const onPreviewUrlChangeRef = React.useRef(props.onPreviewUrlChange);

    React.useEffect(() => {
        onPreviewUrlChangeRef.current = props.onPreviewUrlChange;
    }, [props.onPreviewUrlChange]);

    React.useEffect(() => {
        if (sameMachinePreviewUrl || Platform.OS !== 'web' || !relayEnabled) {
            setRelayPreviewUrl(null);
            setRelayNamespaceStrategy(null);
            setRelayState('idle');
            return;
        }

        let cancelled = false;
        setRelayState('loading');
        setRelayPreviewUrl(null);
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
                setRelayPreviewUrl(applyInitialPreviewPath(previewUrl, props.initialPath));
                setRelayNamespaceStrategy(parsed.data.namespaceStrategy === 'host' ? 'host' : 'path');
                setRelayState('ready');
            })
            .catch(() => {
                if (cancelled) {
                    return;
                }
                setRelayPreviewUrl(null);
                setRelayNamespaceStrategy(null);
                setRelayState('error');
            });

        return () => {
            cancelled = true;
        };
    }, [props.initialPath, props.machineId, props.routeKey, props.sessionId, relayEnabled, relayPreviewFallbackBaseUrl, sameMachinePreviewUrl]);

    const previewUrl = sameMachinePreviewUrl ?? relayPreviewUrl;
    React.useEffect(() => {
        onPreviewUrlChangeRef.current?.(previewUrl);
    }, [previewUrl]);

    const iframeSandbox = sameMachinePreviewUrl
        ? undefined
        : relayNamespaceStrategy === 'host'
            ? 'allow-downloads allow-forms allow-modals allow-popups allow-scripts allow-same-origin'
            : 'allow-downloads allow-forms allow-modals allow-popups allow-scripts';

    return (
        <View style={styles.container}>
            {previewUrl ? (
                <View style={styles.previewFrameContainer}>
                    {React.createElement('iframe', {
                        src: previewUrl,
                        title: iframeTitle,
                        testID: 'session.localServicePreview.iframe',
                        'data-testid': 'session.localServicePreview.iframe',
                        ...(iframeSandbox ? { sandbox: iframeSandbox } : {}),
                        style: {
                            width: '100%',
                            height: '100%',
                            border: '0',
                            display: 'block',
                        },
                    })}
                </View>
            ) : relayState === 'loading' ? (
                <View style={styles.loading}>
                    <ActivityIndicator />
                </View>
            ) : (
                <View style={styles.unavailable}>
                    <Text selectable style={styles.secondary}>{t('common.unavailable')}</Text>
                </View>
            )}
        </View>
    );
}
