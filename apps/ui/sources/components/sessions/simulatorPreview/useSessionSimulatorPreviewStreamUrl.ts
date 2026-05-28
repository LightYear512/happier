import * as React from 'react';
import { SessionDevPreviewTokenResponseSchema } from '@happier-dev/protocol';

import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { serverFetch } from '@/sync/http/client';

export type SessionSimulatorPreviewStreamRelay = Readonly<{
    machineId: string;
    routeKey: string;
    streamPath: string;
}>;

export type SessionSimulatorPreviewStreamState = 'idle' | 'loading' | 'ready' | 'error';

export function buildSimulatorPreviewRelayFallbackBaseUrl(params: Readonly<{
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

function appendSimulatorStreamPath(baseUrl: string, streamPath: string): string | null {
    const normalizedPath = streamPath.startsWith('/') && !streamPath.startsWith('//') ? streamPath : '/stream.mjpeg';
    try {
        const url = new URL(baseUrl);
        const basePath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
        url.pathname = `${basePath}${normalizedPath.slice(1)}`;
        return url.toString();
    } catch {
        return null;
    }
}

export function useSessionSimulatorPreviewStreamUrl(params: Readonly<{
    sessionId: string;
    directStreamUrl: string;
    relay?: SessionSimulatorPreviewStreamRelay | undefined;
}>): Readonly<{ streamUrl: string; state: SessionSimulatorPreviewStreamState }> {
    const relayEnabled = useFeatureEnabled('sessions.devPreview.relay');
    const [relayStreamUrl, setRelayStreamUrl] = React.useState<string | null>(null);
    const [relayState, setRelayState] = React.useState<SessionSimulatorPreviewStreamState>('idle');
    const relay = params.relay;
    const relayMachineId = relay?.machineId;
    const relayRouteKey = relay?.routeKey;
    const relayStreamPath = relay?.streamPath;

    React.useEffect(() => {
        if (!relayEnabled || !relayMachineId || !relayRouteKey || !relayStreamPath) {
            setRelayStreamUrl(null);
            setRelayState('idle');
            return;
        }

        let cancelled = false;
        setRelayStreamUrl(null);
        setRelayState('loading');

        void serverFetch(
            `/v1/sessions/${encodeURIComponent(params.sessionId)}/dev-preview/${encodeURIComponent(relayMachineId)}/${encodeURIComponent(relayRouteKey)}/token`,
            { method: 'POST' },
        )
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`preview token request failed: ${response.status}`);
                }
                const parsed = SessionDevPreviewTokenResponseSchema.safeParse(await response.json());
                if (!parsed.success) {
                    throw new Error('invalid preview token payload');
                }
                if (cancelled) {
                    return;
                }
                const baseUrl = typeof parsed.data.previewUrl === 'string' && parsed.data.previewUrl.trim().length > 0
                    ? parsed.data.previewUrl.trim()
                    : (() => {
                        const fallback = buildSimulatorPreviewRelayFallbackBaseUrl({
                            sessionId: params.sessionId,
                            machineId: relayMachineId,
                            routeKey: relayRouteKey,
                        });
                        if (!fallback) {
                            throw new Error('missing relay preview URL');
                        }
                        const url = new URL(fallback);
                        url.searchParams.set('previewToken', parsed.data.token);
                        return url.toString();
                    })();
                const streamUrl = appendSimulatorStreamPath(baseUrl, relayStreamPath);
                if (!streamUrl) {
                    throw new Error('invalid simulator stream URL');
                }
                setRelayStreamUrl(streamUrl);
                setRelayState('ready');
            })
            .catch(() => {
                if (cancelled) {
                    return;
                }
                setRelayStreamUrl(null);
                setRelayState('error');
            });

        return () => {
            cancelled = true;
        };
    }, [params.sessionId, relayEnabled, relayMachineId, relayRouteKey, relayStreamPath]);

    return {
        streamUrl: relayStreamUrl ?? params.directStreamUrl,
        state: relayState,
    };
}
