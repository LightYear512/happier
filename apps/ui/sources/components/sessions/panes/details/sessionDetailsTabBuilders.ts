import type { DetailsTab } from '@/components/appShell/panes/model/appPaneReducer';
import type { LocalServicePreviewV1 } from '@happier-dev/protocol';

import { createSessionDetailsTerminalTab } from '@/components/sessions/terminal/embeddedTerminalDocking';
import { t } from '@/text';

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

export function createSessionLocalServicePreviewDetailsTab(payload: LocalServicePreviewV1): DetailsTab {
    const title = typeof payload.name === 'string' && payload.name.trim().length > 0
        ? payload.name.trim()
        : `127.0.0.1:${payload.port}`;

    return {
        key: `localServicePreview:${payload.resourceId}`,
        kind: 'localServicePreview',
        title,
        subtitle: payload.machineId,
        resource: {
            kind: 'localServicePreview',
            resourceId: payload.resourceId,
            sessionId: payload.sessionId,
            machineId: payload.machineId,
            port: payload.port,
            routeKey: payload.preview.routeKey,
            rewriteUrls: payload.preview.rewriteUrls,
            supportsWebSocket: payload.preview.supportsWebSocket,
            healthStatus: payload.health.status,
            ...(payload.name ? { name: payload.name } : {}),
            ...(payload.framework ? { framework: payload.framework } : {}),
        },
    };
}

export { createSessionDetailsTerminalTab };
