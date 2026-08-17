import { createSessionDetailsTerminalTab } from '@/components/sessions/terminal/embeddedTerminalDocking';
import type { DetailsTab } from '@/components/appShell/panes/model/appPaneReducer';
import type { TranscriptJumpScope } from '@/components/sessions/transcript/viewport/jump/transcriptJumpTargetTypes';
import type { LocalServicePreviewV1, SimulatorPreviewV1 } from '@happier-dev/protocol';
import { t } from '@/text';

import {
    resolveSessionTranscriptDetailsTabKey,
    type SessionTranscriptDetailsTab,
} from './sessionTranscriptDetailsResource';

export const SESSION_DETAILS_SCM_REVIEW_TAB_KEY = 'scmReview:working';
export const SESSION_DETAILS_SCM_STASH_TAB_KEY = 'scmStash';

export function createSessionFileDetailsTab(fullPath: string) {
    const fileName = fullPath.split('/').pop() ?? fullPath;
    return {
        key: `file:${fullPath}`,
        kind: 'file' as const,
        title: fileName,
        resource: { kind: 'file' as const, path: fullPath },
    };
}

export function createSessionCommitDetailsTab(sha: string) {
    const safeSha = sha.trim().split(/\s+/)[0] ?? '';
    if (!safeSha) return null;

    return {
        key: `commit:${safeSha}`,
        kind: 'commit' as const,
        title: safeSha.slice(0, 7),
        resource: { kind: 'commit' as const, sha: safeSha },
    };
}

export function createSessionScmReviewDetailsTab() {
    return {
        key: SESSION_DETAILS_SCM_REVIEW_TAB_KEY,
        kind: 'scmReview' as const,
        title: t('files.toolbar.review'),
        resource: { kind: 'scmReview' as const, scope: 'working' as const },
    };
}

export function createSessionScmStashDetailsTab() {
    return {
        key: SESSION_DETAILS_SCM_STASH_TAB_KEY,
        kind: 'scmStash' as const,
        title: t('files.stash.detailsTitle'),
        resource: { kind: 'scmStash' as const },
    };
}

/**
 * A transcript details tab, built the way the subagent one is: the key is derived from the thing
 * being opened, so pressing "open details" twice reuses one tab instead of stacking duplicates.
 *
 * The title falls back to the shared unnamed-agent string rather than to a blank label — an
 * imported sidecar can arrive before its agent is named, and a tab with no name is unfindable.
 */
export function createSessionTranscriptDetailsTab(params: Readonly<{
    scope: TranscriptJumpScope;
    title?: string | null;
}>): SessionTranscriptDetailsTab {
    const title = params.title?.trim();
    return {
        key: resolveSessionTranscriptDetailsTabKey(params.scope),
        kind: 'transcript' as const,
        title: title && title.length > 0 ? title : t('session.agentActivity.untitled'),
        resource: {
            kind: 'transcript' as const,
            scope: params.scope,
            ...(title && title.length > 0 ? { title } : null),
        },
    };
}

function formatLocalServicePreviewSubtitle(payload: LocalServicePreviewV1): string {
    if (typeof payload.url === 'string' && payload.url.trim().length > 0) {
        return payload.url.trim();
    }
    if (typeof payload.origin === 'string' && payload.origin.trim().length > 0) {
        return payload.origin.trim();
    }
    return `http://127.0.0.1:${payload.port}`;
}

export function createSessionLocalServicePreviewDetailsTab(payload: LocalServicePreviewV1): DetailsTab {
    const title = typeof payload.name === 'string' && payload.name.trim().length > 0
        ? payload.name.trim()
        : `127.0.0.1:${payload.port}`;

    return {
        key: `localServicePreview:${payload.resourceId}`,
        kind: 'localServicePreview',
        title,
        subtitle: formatLocalServicePreviewSubtitle(payload),
        resource: {
            kind: 'localServicePreview',
            resourceId: payload.resourceId,
            sessionId: payload.sessionId,
            machineId: payload.machineId,
            port: payload.port,
            ...(payload.origin ? { origin: payload.origin } : {}),
            ...(payload.url ? { url: payload.url } : {}),
            routeKey: payload.preview.routeKey,
            ...(payload.preview.initialPath ? { initialPath: payload.preview.initialPath } : {}),
            rewriteUrls: payload.preview.rewriteUrls,
            supportsWebSocket: payload.preview.supportsWebSocket,
            healthStatus: payload.health.status,
            ...(payload.name ? { name: payload.name } : {}),
            ...(payload.framework ? { framework: payload.framework } : {}),
        },
    };
}

export function createSessionSimulatorPreviewDetailsTab(payload: SimulatorPreviewV1): DetailsTab {
    const title = payload.deviceName.trim();
    const subtitle = payload.appName && payload.appName.trim().length > 0
        ? payload.appName.trim()
        : payload.platform === 'ios'
            ? t('session.simulatorPreview.defaultIosSubtitle')
            : t('session.simulatorPreview.defaultAndroidSubtitle');

    return {
        key: `simulatorPreview:${payload.simulatorSessionId}`,
        kind: 'simulatorPreview',
        title,
        subtitle,
        resource: {
            kind: 'simulatorPreview',
            simulatorSessionId: payload.simulatorSessionId,
            sessionId: payload.sessionId,
            platform: payload.platform,
            deviceName: payload.deviceName,
            ...(payload.appName ? { appName: payload.appName } : {}),
            streamUrl: payload.streamUrl,
            mode: payload.mode,
            ...(payload.owner ? { owner: payload.owner } : {}),
            connectionPath: payload.connectionPath,
            ...(payload.controlCapability ? { controlCapability: payload.controlCapability } : {}),
            ...(payload.controlUnavailableReason ? { controlUnavailableReason: payload.controlUnavailableReason } : {}),
            ...(payload.deviceRef ? { deviceRef: payload.deviceRef } : {}),
            ...(payload.deviceDisplayName ? { deviceDisplayName: payload.deviceDisplayName } : {}),
            ...(payload.nativeDevSessionId ? { nativeDevSessionId: payload.nativeDevSessionId } : {}),
            ...(payload.devServices ? { devServices: payload.devServices } : {}),
        },
    };
}

export { createSessionDetailsTerminalTab };
