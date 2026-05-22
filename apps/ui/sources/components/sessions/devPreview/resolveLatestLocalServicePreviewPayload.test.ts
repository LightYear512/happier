import { describe, expect, it } from 'vitest';

import type { Message } from '@/sync/domains/messages/messageTypes';

import {
    listLocalServicePreviewPayloads,
    resolveLatestLocalServicePreviewPayload,
} from './resolveLatestLocalServicePreviewPayload';

function previewMessage(params: Readonly<{ id: string; resourceId: string; port: number }>): Message {
    return {
        kind: 'user-text',
        id: params.id,
        localId: params.id,
        createdAt: 1,
        text: 'preview',
        meta: {
            happier: {
                kind: 'local_service_preview.v1',
                payload: {
                    resourceId: params.resourceId,
                    sessionId: 's1',
                    machineId: 'machine-1',
                    port: params.port,
                    source: 'mcp_tool',
                    registeredAtMs: 1,
                    health: {
                        status: 'ready',
                        checkedAtMs: 1,
                    },
                    preview: {
                        rewriteUrls: true,
                        supportsWebSocket: true,
                        routeKey: `route_${params.resourceId}`,
                    },
                },
            },
        },
    };
}

describe('resolveLatestLocalServicePreviewPayload', () => {
    it('returns the newest valid local service preview payload', () => {
        const latest = resolveLatestLocalServicePreviewPayload([
            previewMessage({ id: 'm1', resourceId: 'preview_1', port: 3000 }),
            {
                kind: 'agent-text',
                id: 'm2',
                localId: 'm2',
                createdAt: 2,
                text: 'done',
            },
            previewMessage({ id: 'm3', resourceId: 'preview_2', port: 5173 }),
        ]);

        expect(latest?.resourceId).toBe('preview_2');
        expect(latest?.port).toBe(5173);
    });

    it('ignores invalid preview metadata', () => {
        const latest = resolveLatestLocalServicePreviewPayload([
            {
                kind: 'user-text',
                id: 'm1',
                localId: 'm1',
                createdAt: 1,
                text: 'bad preview',
                meta: {
                    happier: {
                        kind: 'local_service_preview.v1',
                        payload: {
                            resourceId: 'preview_bad',
                        },
                    },
                },
            },
        ]);

        expect(latest).toBeNull();
    });
});

describe('listLocalServicePreviewPayloads', () => {
    it('returns unique valid preview payloads newest first', () => {
        const previews = listLocalServicePreviewPayloads([
            previewMessage({ id: 'm1', resourceId: 'preview_1', port: 3000 }),
            previewMessage({ id: 'm2', resourceId: 'preview_2', port: 5173 }),
            previewMessage({ id: 'm3', resourceId: 'preview_1', port: 4173 }),
        ]);

        expect(previews.map((preview) => [preview.resourceId, preview.port])).toEqual([
            ['preview_1', 4173],
            ['preview_2', 5173],
        ]);
    });
});
