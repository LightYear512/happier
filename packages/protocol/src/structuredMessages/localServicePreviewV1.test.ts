import { describe, expect, it } from 'vitest';

import { LocalServicePreviewV1Schema } from './localServicePreviewV1';

describe('LocalServicePreviewV1Schema', () => {
  it('accepts a registered preview with service origin and initial page path', () => {
    const parsed = LocalServicePreviewV1Schema.parse({
      resourceId: 'preview_1',
      sessionId: 'session_1',
      machineId: 'machine_1',
      port: 5173,
      origin: 'http://127.0.0.1:5173',
      url: 'http://127.0.0.1:5173/ai-console/develop/',
      name: 'Vite app',
      framework: 'vite',
      source: 'mcp_tool',
      registeredAtMs: 1,
      health: { status: 'ready', checkedAtMs: 2 },
      preview: {
        rewriteUrls: true,
        supportsWebSocket: true,
        routeKey: 'route_1',
        initialPath: '/ai-console/develop/',
      },
    });

    expect(parsed.origin).toBe('http://127.0.0.1:5173');
    expect(parsed.url).toBe('http://127.0.0.1:5173/ai-console/develop/');
    expect(parsed.preview.initialPath).toBe('/ai-console/develop/');
  });
});
