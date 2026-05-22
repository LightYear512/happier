import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionDevPreviewRegistry } from '@/session/devPreview/createSessionDevPreviewRegistry';
import { createDaemonControlApp } from './controlServer';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve server address');
  }
  return address.port;
}

describe('daemon control server: /dev-preview/register', () => {
  let previewServer: Server | null = null;

  afterEach(async () => {
    if (previewServer) {
      await new Promise<void>((resolve, reject) => previewServer!.close((error) => (error ? reject(error) : resolve())));
      previewServer = null;
    }
  });

  it('registers a manual preview in the shared daemon registry', async () => {
    previewServer = createServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    const previewPort = await listen(previewServer);
    const registry = createSessionDevPreviewRegistry({ healthCheckTimeoutMs: 100 });

    const app = createDaemonControlApp({
      getChildren: () => [],
      machineId: 'machine-local',
      stopSession: async () => false,
      spawnSession: async () => ({ type: 'success', sessionId: 'unused' }),
      requestShutdown: () => {},
      onHappySessionWebhook: () => {},
      controlToken: 'test-token',
      devPreviewRegistry: registry,
    });

    try {
      await app.ready();
      const response = await app.inject({
        method: 'POST',
        url: '/dev-preview/register',
        headers: { 'x-happier-daemon-token': 'test-token' },
        payload: {
          sessionId: 'sess-preview-1',
          expectedMachineId: 'machine-local',
          url: `http://127.0.0.1:${previewPort}/dashboard`,
          name: 'Manual preview',
          framework: 'vite',
          rewriteUrls: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.preview).toMatchObject({
        sessionId: 'sess-preview-1',
        machineId: 'machine-local',
        port: previewPort,
        url: `http://127.0.0.1:${previewPort}/dashboard`,
        origin: `http://127.0.0.1:${previewPort}`,
        name: 'Manual preview',
        framework: 'vite',
        source: 'manual',
        health: { status: 'ready' },
        preview: {
          rewriteUrls: false,
          supportsWebSocket: true,
          initialPath: '/dashboard',
        },
      });
      expect(registry.getByRouteKey(body.preview.preview.routeKey)?.resourceId).toBe(body.preview.resourceId);
    } finally {
      await app.close();
    }
  });

  it('rejects registration when the caller expects a different machine', async () => {
    const app = createDaemonControlApp({
      getChildren: () => [],
      machineId: 'machine-local',
      stopSession: async () => false,
      spawnSession: async () => ({ type: 'success', sessionId: 'unused' }),
      requestShutdown: () => {},
      onHappySessionWebhook: () => {},
      controlToken: 'test-token',
      devPreviewRegistry: createSessionDevPreviewRegistry({ healthCheckTimeoutMs: 100 }),
    });

    try {
      await app.ready();
      const response = await app.inject({
        method: 'POST',
        url: '/dev-preview/register',
        headers: { 'x-happier-daemon-token': 'test-token' },
        payload: {
          sessionId: 'sess-preview-1',
          expectedMachineId: 'machine-other',
          port: 3000,
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        success: false,
        errorCode: 'machine_mismatch',
        error: 'machine_mismatch',
        machineId: 'machine-local',
        expectedMachineId: 'machine-other',
      });
    } finally {
      await app.close();
    }
  });
});
