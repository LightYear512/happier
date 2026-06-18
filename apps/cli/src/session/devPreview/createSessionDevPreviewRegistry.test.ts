import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionDevPreviewRegistry } from './createSessionDevPreviewRegistry';

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

describe('createSessionDevPreviewRegistry', () => {
  let previewServer: Server | null = null;

  afterEach(async () => {
    if (previewServer) {
      await new Promise<void>((resolve, reject) => previewServer!.close((error) => (error ? reject(error) : resolve())));
      previewServer = null;
    }
  });

  it('lists active previews and reuses the same resource for duplicate registrations', async () => {
    previewServer = createServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    const port = await listen(previewServer);
    const registry = createSessionDevPreviewRegistry({ healthCheckTimeoutMs: 100 });

    const first = await registry.register({
      sessionId: 's1',
      machineId: 'm1',
      port,
      name: 'First name',
      source: 'mcp_tool',
    });
    const second = await registry.register({
      sessionId: 's1',
      machineId: 'm1',
      port,
      name: 'Updated name',
      source: 'mcp_tool',
    });

    expect(second.resourceId).toBe(first.resourceId);
    expect(second.preview.routeKey).toBe(first.preview.routeKey);
    expect(registry.list({ sessionId: 's1', machineId: 'm1' })).toEqual([second]);
  });

  it('closes a preview and removes its routeKey from active lookup', async () => {
    previewServer = createServer((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    const port = await listen(previewServer);
    const registry = createSessionDevPreviewRegistry({ healthCheckTimeoutMs: 100 });

    const preview = await registry.register({
      sessionId: 's1',
      machineId: 'm1',
      port,
      source: 'mcp_tool',
    });

    expect(registry.close({ sessionId: 's1', machineId: 'm1', resourceId: preview.resourceId })).toEqual({
      closed: true,
      preview,
    });
    expect(registry.getByRouteKey(preview.preview.routeKey)).toBeNull();
    expect(registry.getByResourceId(preview.resourceId)).toBeNull();
    expect(registry.list({ sessionId: 's1', machineId: 'm1' })).toEqual([]);
  });
});
