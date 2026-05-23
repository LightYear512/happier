import { createServer as createHttpServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { createSessionDevPreviewRegistry } from '@/session/devPreview/createSessionDevPreviewRegistry';

import { registerMachineDevPreviewRpcHandlers } from './rpcHandlers.devPreview';

describe('rpcHandlers.devPreview', () => {
  afterEach(() => {
    delete process.env.HAPPIER_SESSION_DEV_PREVIEW_HTTP_TIMEOUT_MS;
  });

  it('relays an HTTP request through a registered routeKey and strips Happier credentials', async () => {
    const seenHeaders: Record<string, string | string[] | undefined>[] = [];
    const server = createHttpServer((req, res) => {
      seenHeaders.push(req.headers);
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'set-cookie': 'session=dev-only',
      });
      res.end(`upstream:${req.url ?? ''}`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (raw: unknown) => Promise<unknown>) => {
        handlers.set(method, handler);
      },
    } as any;

    const registry = createSessionDevPreviewRegistry();
    const port = Number((server.address() as { port: number }).port);
    const preview = await registry.register({
      sessionId: 'session_1',
      machineId: 'machine_1',
      port,
      source: 'manual',
    });

    registerMachineDevPreviewRpcHandlers({
      rpcHandlerManager,
      registry,
    });

    const handler = handlers.get(RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP);
    expect(handler).toBeTruthy();

    const response = await handler!({
      sessionId: 'session_1',
      machineId: 'machine_1',
      routeKey: preview.preview.routeKey,
      method: 'GET',
      path: '/src/main.ts',
      search: '?v=1',
      headers: {
        accept: 'text/plain',
        authorization: 'Bearer secret',
        cookie: 'session=main-app',
        'x-forwarded-host': 'app.happier.dev',
      },
    }) as any;

    expect(response).toMatchObject({
      ok: true,
      status: 200,
    });
    expect(Buffer.from(response.bodyBase64, 'base64').toString('utf8')).toBe('upstream:/src/main.ts?v=1');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(seenHeaders).toHaveLength(1);
    expect(seenHeaders[0]?.authorization).toBeUndefined();
    expect(seenHeaders[0]?.cookie).toBeUndefined();
    expect(seenHeaders[0]?.['x-forwarded-host']).toBeUndefined();

    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('does not forward browser accept negotiation to the loopback dev server', async () => {
    const seenHeaders: Record<string, string | string[] | undefined>[] = [];
    const server = createHttpServer((req, res) => {
      seenHeaders.push(req.headers);
      const accept = String(req.headers.accept ?? '');
      res.writeHead(200, { 'content-type': accept.includes('text/css') ? 'text/css' : 'text/javascript' });
      res.end(accept.includes('text/css') ? '.style { color: red; }' : 'export default true;');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (raw: unknown) => Promise<unknown>) => {
        handlers.set(method, handler);
      },
    } as any;

    const registry = createSessionDevPreviewRegistry();
    const port = Number((server.address() as { port: number }).port);
    const preview = await registry.register({
      sessionId: 'session_1',
      machineId: 'machine_1',
      port,
      source: 'manual',
    });

    registerMachineDevPreviewRpcHandlers({
      rpcHandlerManager,
      registry,
    });

    const handler = handlers.get(RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP);
    expect(handler).toBeTruthy();

    const response = await handler!({
      sessionId: 'session_1',
      machineId: 'machine_1',
      routeKey: preview.preview.routeKey,
      method: 'GET',
      path: '/src/components/TopBar.vue',
      search: '?vue&type=style&lang.css',
      headers: {
        accept: 'text/css,*/*;q=0.1',
      },
    }) as any;

    expect(response).toMatchObject({
      ok: true,
      status: 200,
      headers: {
        'content-type': 'text/javascript',
      },
    });
    expect(Buffer.from(response.bodyBase64, 'base64').toString('utf8')).toBe('export default true;');
    expect(seenHeaders[0]?.accept).not.toContain('text/css');

    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('rejects unknown routeKeys before contacting loopback', async () => {
    const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (raw: unknown) => Promise<unknown>) => {
        handlers.set(method, handler);
      },
    } as any;

    registerMachineDevPreviewRpcHandlers({
      rpcHandlerManager,
      registry: createSessionDevPreviewRegistry(),
    });

    const handler = handlers.get(RPC_METHODS.DAEMON_SESSION_DEV_PREVIEW_HTTP);
    expect(handler).toBeTruthy();

    const response = await handler!({
      sessionId: 'session_1',
      machineId: 'machine_1',
      routeKey: 'missing_route',
      method: 'GET',
      path: '/',
      headers: {},
    }) as any;

    expect(response).toMatchObject({
      ok: false,
      errorCode: 'preview_not_found',
    });
  });
});
