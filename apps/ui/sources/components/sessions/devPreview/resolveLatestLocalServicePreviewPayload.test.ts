import { describe, expect, it } from 'vitest';

import type { Message } from '@/sync/domains/messages/messageTypes';

import {
    listLocalServicePreviewPayloadsFromSources,
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

    it('recovers preview payloads from MCP tool results when message metadata is unavailable', () => {
        const previews = listLocalServicePreviewPayloads([
            {
                kind: 'tool-call',
                id: 'mcp-preview-register',
                localId: null,
                createdAt: 1,
                tool: {
                    id: 'call_1',
                    name: 'mcp__happier__happier_dev_preview_register',
                    state: 'completed',
                    input: {},
                    createdAt: 1,
                    startedAt: 1,
                    completedAt: 2,
                    description: null,
                    result: JSON.stringify({
                        resourceId: 'preview_from_tool_result',
                        sessionId: 's1',
                        machineId: 'machine-1',
                        port: 55365,
                        origin: 'http://127.0.0.1:55365',
                        url: 'http://127.0.0.1:55365/ai-console/develop/',
                        name: 'layaideamanagementpage-ai',
                        framework: 'vite',
                        source: 'manual',
                        registeredAtMs: 1,
                        health: {
                            status: 'ready',
                            checkedAtMs: 1,
                        },
                        preview: {
                            rewriteUrls: true,
                            supportsWebSocket: true,
                            routeKey: 'route_1',
                        },
                    }),
                },
                children: [],
            },
        ]);

        expect(previews.map((preview) => [preview.resourceId, preview.port])).toEqual([
            ['preview_from_tool_result', 55365],
        ]);
    });

    it('includes session metadata previews before transcript previews', () => {
        const previews = listLocalServicePreviewPayloadsFromSources({
            metadata: {
                localServicePreviewsV1: {
                    v: 1,
                    previews: [
                        {
                            resourceId: 'preview_metadata',
                            sessionId: 's1',
                            machineId: 'machine-1',
                            port: 55365,
                            source: 'mcp_tool',
                            registeredAtMs: 3,
                            health: { status: 'ready', checkedAtMs: 3 },
                            preview: {
                                rewriteUrls: true,
                                supportsWebSocket: true,
                                routeKey: 'route_metadata',
                            },
                        },
                    ],
                },
            },
            messages: [previewMessage({ id: 'm1', resourceId: 'preview_message', port: 5173 })],
        });

        expect(previews.map((preview) => [preview.resourceId, preview.port])).toEqual([
            ['preview_metadata', 55365],
            ['preview_message', 5173],
        ]);
    });
});
