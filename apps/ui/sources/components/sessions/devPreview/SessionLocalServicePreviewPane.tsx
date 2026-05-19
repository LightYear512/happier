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
        padding: 16,
        gap: 10,
        backgroundColor: theme.colors.surface.base,
    },
    previewFrameContainer: {
        flex: 1,
        minHeight: 320,
        overflow: 'hidden',
    },
    title: {
        color: theme.colors.text.primary,
        fontSize: 16,
        fontWeight: '600',
    },
    secondary: {
        color: theme.colors.text.secondary,
        fontSize: 12,
    },
    loading: {
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
    },
}));

export function SessionLocalServicePreviewPane(props: Readonly<{
    scopeId: string;
    resourceId: string;
    sessionId: string;
    machineId: string;
    port: number;
    routeKey: string;
    rewriteUrls: boolean;
    supportsWebSocket: boolean;
    name?: string;
    healthStatus?: string;
}>) {
    const title = typeof props.name === 'string' && props.name.trim().length > 0
        ? props.name.trim()
        : `127.0.0.1:${props.port}`;
    const relayEnabled = useFeatureEnabled('sessions.devPreview.relay');
    const sameMachinePreviewUrl = React.useMemo(() => resolveSameMachinePreviewUrl(props.port), [props.port]);
    const relayPreviewBaseUrl = React.useMemo(
        () => resolveRelayPreviewBaseUrl({
            sessionId: props.sessionId,
            machineId: props.machineId,
            routeKey: props.routeKey,
        }),
        [props.machineId, props.routeKey, props.sessionId],
    );
    const [relayToken, setRelayToken] = React.useState<string | null>(null);
    const [relayState, setRelayState] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

    React.useEffect(() => {
        if (sameMachinePreviewUrl || Platform.OS !== 'web' || !relayEnabled || !relayPreviewBaseUrl) {
            setRelayToken(null);
            setRelayState('idle');
            return;
        }

        let cancelled = false;
        setRelayState('loading');
        setRelayToken(null);

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
                setRelayToken(parsed.data.token);
                setRelayState('ready');
            })
            .catch(() => {
                if (cancelled) {
                    return;
                }
                setRelayToken(null);
                setRelayState('error');
            });

        return () => {
            cancelled = true;
        };
    }, [props.machineId, props.routeKey, props.sessionId, relayEnabled, relayPreviewBaseUrl, sameMachinePreviewUrl]);

    const relayPreviewUrl = React.useMemo(() => {
        if (!relayPreviewBaseUrl || !relayToken) {
            return null;
        }
        const url = new URL(relayPreviewBaseUrl);
        url.searchParams.set('previewToken', relayToken);
        return url.toString();
    }, [relayPreviewBaseUrl, relayToken]);
    const previewUrl = sameMachinePreviewUrl ?? relayPreviewUrl;
    const iframeSandbox = sameMachinePreviewUrl
        ? undefined
        : 'allow-downloads allow-forms allow-modals allow-popups allow-scripts';

    return (
        <View style={styles.container}>
            <Text selectable style={styles.title}>{title}</Text>
            <Text selectable style={styles.secondary}>{`127.0.0.1:${props.port}`}</Text>
            <Text selectable style={styles.secondary}>{props.machineId}</Text>
            {typeof props.healthStatus === 'string' ? (
                <Text selectable style={styles.secondary}>{props.healthStatus}</Text>
            ) : null}
            {previewUrl ? (
                <View style={styles.previewFrameContainer}>
                    {React.createElement('iframe', {
                        src: previewUrl,
                        title,
                        testID: 'session.localServicePreview.iframe',
                        'data-testid': 'session.localServicePreview.iframe',
                        ...(iframeSandbox ? { sandbox: iframeSandbox } : {}),
                        style: {
                            width: '100%',
                            height: '100%',
                            minHeight: '320px',
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
                <Text selectable style={styles.secondary}>{t('common.unavailable')}</Text>
            )}
        </View>
    );
}
