import Fastify from 'fastify';
import { createRequire } from 'node:module';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';

import { auth } from '@/app/auth/auth';
import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';

import { startSocket } from '../../socket';
import { sessionRoutes } from './sessionRoutes';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws') as {
  WebSocketServer: new (...args: unknown[]) => {
    address(): { port: number } | null;
    on(event: 'listening', listener: () => void): void;
    on(event: 'connection', listener: (socket: {
      protocol: string;
      send(data: string | Uint8Array): void;
      close(code?: number, reason?: string): void;
      on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): void;
    }) => void): void;
    close(callback?: (error?: Error) => void): void;
  };
};
const { WebSocket: WebSocketClient } = require('ws') as {
  WebSocket: new (url: string, protocols?: string[], options?: { headers?: Record<string, string> }) => WebSocket;
};

describe('session dev preview websocket relay (integration)', () => {
  let harness: LightSqliteHarness;

  beforeAll(async () => {
    harness = await createLightSqliteHarness({
      tempDirPrefix: 'happier-session-dev-preview-ws-routes-',
      initAuth: true,
    });
  }, 120_000);

  afterAll(async () => {
    await harness.close();
  });

  afterEach(async () => {
    harness.resetEnv();
    await db.accessKey.deleteMany().catch(() => {});
    await db.session.deleteMany().catch(() => {});
    await db.machine.deleteMany().catch(() => {});
    await db.account.deleteMany().catch(() => {});
    vi.restoreAllMocks();
  });

  async function createFixture() {
    const account = await db.account.create({
      data: { publicKey: 'pk_preview_ws_routes' },
      select: { id: true },
    });
    const machine = await db.machine.create({
      data: {
        id: 'machine_1',
        accountId: account.id,
        metadata: '{}',
      },
      select: { id: true },
    });
    const session = await db.session.create({
      data: {
        tag: 'preview-ws-route-session',
        accountId: account.id,
        metadata: '{}',
      },
      select: { id: true },
    });
    await db.accessKey.create({
      data: {
        accountId: account.id,
        machineId: machine.id,
        sessionId: session.id,
        data: '{}',
      },
    });
    const token = await auth.createToken(account.id);
    return { accountId: account.id, machineId: machine.id, sessionId: session.id, token };
  }

  function createApp() {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as any;

    typed.decorate('authenticate', async (request: any, reply: any) => {
      const authHeader = String(request.headers.authorization ?? '');
      if (!authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Missing authorization header' });
      }
      const token = authHeader.slice(7);
      const verified = await auth.verifyToken(token);
      if (!verified) {
        return reply.code(401).send({ error: 'Invalid token', code: 'invalid-token' });
      }
      request.userId = verified.userId;
    });

    sessionRoutes(typed);
    startSocket(typed);
    return typed;
  }

  it('relays websocket preview frames through the machine-scoped socket and preserves the accepted subprotocol', async () => {
    harness.resetEnv({
      NODE_ENV: 'development',
      HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED: '1',
    });
    const fixture = await createFixture();
    const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: () => 'vite-hmr' });
    await new Promise<void>((resolve) => {
      upstream.on('listening', () => resolve());
    });
    const upstreamMessages: Array<string | Buffer> = [];
    upstream.on('connection', (socket) => {
      socket.send('hello-from-upstream');
      socket.on('message', (data, isBinary) => {
        upstreamMessages.push(isBinary ? Buffer.from(data) : data.toString('utf8'));
        socket.send(isBinary ? Buffer.from(data) : `echo:${data.toString('utf8')}`);
        socket.close(1000, 'done');
      });
    });

    const upstreamAddress = upstream.address();
    if (!upstreamAddress) {
      throw new Error('Upstream websocket server did not bind');
    }
    const upstreamPort = upstreamAddress.port;
    const app = createApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const appPort = typeof address === 'object' && address ? address.port : null;
    if (!appPort) {
      throw new Error('Failed to bind preview websocket app');
    }

    const machineSocket = ioClient(`http://127.0.0.1:${appPort}`, {
      path: '/v1/updates',
      transports: ['websocket'],
      reconnection: false,
      auth: {
        token: fixture.token,
        clientType: 'machine-scoped',
        machineId: fixture.machineId,
      },
    });

    const handledTunnels = new Map<string, {
      send(data: string | Uint8Array): void;
      close(code?: number, reason?: string): void;
    }>();
    const openedSearches: string[] = [];

    machineSocket.on(SOCKET_RPC_EVENTS.DEV_PREVIEW_TO_MACHINE_ENVELOPE, (payload: any) => {
      if (payload?.envelope?.kind === 'open') {
        openedSearches.push(String(payload.envelope.search ?? ''));
        const ws = new WebSocket(`ws://127.0.0.1:${upstreamPort}${payload.envelope.path}${payload.envelope.search ?? ''}`, payload.envelope.requestedSubprotocols);
        ws.binaryType = 'arraybuffer';
        ws.addEventListener('open', () => {
          handledTunnels.set(payload.envelope.tunnelId, {
            send(data) {
              ws.send(data);
            },
            close(code, reason) {
              ws.close(code, reason);
            },
          });
          machineSocket.emit(SOCKET_RPC_EVENTS.DEV_PREVIEW_FROM_MACHINE_ENVELOPE, {
            envelope: {
              tunnelId: payload.envelope.tunnelId,
              kind: 'open',
              acceptedSubprotocol: ws.protocol || undefined,
            },
          });
        });
        ws.addEventListener('message', async (event) => {
          if (typeof event.data === 'string') {
            machineSocket.emit(SOCKET_RPC_EVENTS.DEV_PREVIEW_FROM_MACHINE_ENVELOPE, {
              envelope: {
                tunnelId: payload.envelope.tunnelId,
                kind: 'text',
                text: event.data,
              },
            });
            return;
          }
          const bytes = event.data instanceof ArrayBuffer ? Buffer.from(event.data) : Buffer.from(await event.data.arrayBuffer());
          machineSocket.emit(SOCKET_RPC_EVENTS.DEV_PREVIEW_FROM_MACHINE_ENVELOPE, {
            envelope: {
              tunnelId: payload.envelope.tunnelId,
              kind: 'binary',
              dataBase64: bytes.toString('base64'),
            },
          });
        });
        ws.addEventListener('close', (event) => {
          handledTunnels.delete(payload.envelope.tunnelId);
          machineSocket.emit(SOCKET_RPC_EVENTS.DEV_PREVIEW_FROM_MACHINE_ENVELOPE, {
            envelope: {
              tunnelId: payload.envelope.tunnelId,
              kind: 'close',
              code: event.code,
              reason: event.reason,
            },
          });
        });
        ws.addEventListener('error', () => {
          machineSocket.emit(SOCKET_RPC_EVENTS.DEV_PREVIEW_FROM_MACHINE_ENVELOPE, {
            envelope: {
              tunnelId: payload.envelope.tunnelId,
              kind: 'error',
              reason: 'upstream_connect_failed',
            },
          });
        });
        return;
      }

      const tunnel = handledTunnels.get(payload?.envelope?.tunnelId);
      if (!tunnel) {
        return;
      }
      if (payload.envelope.kind === 'text') {
        tunnel.send(payload.envelope.text);
      } else if (payload.envelope.kind === 'binary') {
        tunnel.send(Buffer.from(payload.envelope.dataBase64, 'base64'));
      } else if (payload.envelope.kind === 'close') {
        tunnel.close(payload.envelope.code, payload.envelope.reason);
      }
    });

    await new Promise<void>((resolve, reject) => {
      machineSocket.on('connect', () => resolve());
      machineSocket.on('connect_error', reject);
    });

    try {
      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
        },
      });
      const previewToken = (mint.json() as { token: string }).token;

      const previewSocket = new WebSocket(
        `ws://127.0.0.1:${appPort}/preview/${fixture.sessionId}/${fixture.machineId}/route_1/@vite/client?previewToken=${encodeURIComponent(previewToken)}&client=vite`,
        ['vite-hmr'],
      );
      previewSocket.binaryType = 'arraybuffer';
      const closePromise = new Promise<void>((resolve) => {
        previewSocket.addEventListener('close', () => resolve(), { once: true });
      });

      const received: Array<string | Buffer> = [];
      previewSocket.addEventListener('message', async (event) => {
        if (typeof event.data === 'string') {
          received.push(event.data);
          if (event.data === 'hello-from-upstream') {
            previewSocket.send('from-browser');
          }
          return;
        }
        received.push(Buffer.from(event.data));
      });

      await new Promise<void>((resolve, reject) => {
        previewSocket.addEventListener('open', () => resolve());
        previewSocket.addEventListener('error', (event) => reject(event));
      });

      expect(previewSocket.protocol).toBe('vite-hmr');

      await expect.poll(() => received).toEqual([
        'hello-from-upstream',
        'echo:from-browser',
      ]);

      await expect.poll(() => upstreamMessages).toEqual(['from-browser']);
      expect(openedSearches).toEqual(['?client=vite']);

      await closePromise;
    } finally {
      machineSocket.close();
      await app.close();
      await new Promise<void>((resolve, reject) => {
        upstream.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }, 30_000);

  it('relays websocket preview frames through a host-based preview origin', async () => {
    harness.resetEnv({
      HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN: 'preview.example.test',
      HAPPIER_PUBLIC_SERVER_URL: 'http://app.example.test',
      HAPPIER_WEBAPP_URL: undefined,
      HAPPY_WEBAPP_URL: undefined,
    });
    const fixture = await createFixture();
    const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: () => 'vite-hmr' });
    await new Promise<void>((resolve) => {
      upstream.on('listening', () => resolve());
    });
    upstream.on('connection', (socket) => {
      socket.send('hello-from-host-upstream');
      socket.on('message', (data) => {
        socket.send(`host-echo:${data.toString('utf8')}`);
        socket.close(1000, 'done');
      });
    });

    const upstreamAddress = upstream.address();
    if (!upstreamAddress) {
      throw new Error('Upstream websocket server did not bind');
    }
    const upstreamPort = upstreamAddress.port;
    const app = createApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const appPort = typeof address === 'object' && address ? address.port : null;
    if (!appPort) {
      throw new Error('Failed to bind preview websocket app');
    }

    const machineSocket = ioClient(`http://127.0.0.1:${appPort}`, {
      path: '/v1/updates',
      transports: ['websocket'],
      reconnection: false,
      auth: {
        token: fixture.token,
        clientType: 'machine-scoped',
        machineId: fixture.machineId,
      },
    });

    const openedPaths: string[] = [];
    const openedSearches: string[] = [];
    machineSocket.on(SOCKET_RPC_EVENTS.DEV_PREVIEW_TO_MACHINE_ENVELOPE, (payload: any) => {
      if (payload?.envelope?.kind !== 'open') {
        return;
      }
      openedPaths.push(String(payload.envelope.path ?? ''));
      openedSearches.push(String(payload.envelope.search ?? ''));
      const ws = new WebSocket(`ws://127.0.0.1:${upstreamPort}${payload.envelope.path}${payload.envelope.search ?? ''}`, payload.envelope.requestedSubprotocols);
      ws.addEventListener('open', () => {
        machineSocket.emit(SOCKET_RPC_EVENTS.DEV_PREVIEW_FROM_MACHINE_ENVELOPE, {
          envelope: {
            tunnelId: payload.envelope.tunnelId,
            kind: 'open',
            acceptedSubprotocol: ws.protocol || undefined,
          },
        });
      });
      ws.addEventListener('message', (event) => {
        machineSocket.emit(SOCKET_RPC_EVENTS.DEV_PREVIEW_FROM_MACHINE_ENVELOPE, {
          envelope: {
            tunnelId: payload.envelope.tunnelId,
            kind: 'text',
            text: String(event.data),
          },
        });
      });
      ws.addEventListener('close', (event) => {
        machineSocket.emit(SOCKET_RPC_EVENTS.DEV_PREVIEW_FROM_MACHINE_ENVELOPE, {
          envelope: {
            tunnelId: payload.envelope.tunnelId,
            kind: 'close',
            code: event.code,
            reason: event.reason,
          },
        });
      });
      ws.addEventListener('error', () => {
        machineSocket.emit(SOCKET_RPC_EVENTS.DEV_PREVIEW_FROM_MACHINE_ENVELOPE, {
          envelope: {
            tunnelId: payload.envelope.tunnelId,
            kind: 'error',
            reason: 'upstream_connect_failed',
          },
        });
      });
      machineSocket.on(SOCKET_RPC_EVENTS.DEV_PREVIEW_TO_MACHINE_ENVELOPE, (nextPayload: any) => {
        if (nextPayload?.envelope?.tunnelId !== payload.envelope.tunnelId || nextPayload.envelope.kind !== 'text') {
          return;
        }
        ws.send(nextPayload.envelope.text);
      });
    });

    await new Promise<void>((resolve, reject) => {
      machineSocket.on('connect', () => resolve());
      machineSocket.on('connect_error', reject);
    });

    try {
      const mint = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${fixture.sessionId}/dev-preview/${fixture.machineId}/route_1/token`,
        headers: {
          authorization: `Bearer ${fixture.token}`,
          host: `127.0.0.1:${appPort}`,
        },
      });
      const tokenPayload = mint.json() as { token: string; previewUrl: string; namespaceStrategy: string };
      expect(tokenPayload.namespaceStrategy).toBe('host');
      const previewUrl = new URL(tokenPayload.previewUrl);

      const previewSocket = new WebSocketClient(
        `ws://127.0.0.1:${appPort}/@vite/client?previewToken=${encodeURIComponent(tokenPayload.token)}&client=vite`,
        ['vite-hmr'],
        {
          headers: {
            host: `127.0.0.1:${appPort}`,
            'x-forwarded-host': previewUrl.host,
          },
        },
      );
      const closePromise = new Promise<void>((resolve) => {
        previewSocket.addEventListener('close', () => resolve(), { once: true });
      });

      const received: string[] = [];
      previewSocket.addEventListener('message', (event) => {
        received.push(String(event.data));
        if (event.data === 'hello-from-host-upstream') {
          previewSocket.send('from-host-browser');
        }
      });

      await new Promise<void>((resolve, reject) => {
        previewSocket.addEventListener('open', () => resolve());
        previewSocket.addEventListener('error', (event) => reject(event));
      });

      expect(previewSocket.protocol).toBe('vite-hmr');
      await expect.poll(() => received).toEqual([
        'hello-from-host-upstream',
        'host-echo:from-host-browser',
      ]);
      expect(openedPaths).toEqual(['/@vite/client']);
      expect(openedSearches).toEqual(['?client=vite']);

      await closePromise;
    } finally {
      machineSocket.close();
      await app.close();
      await new Promise<void>((resolve, reject) => {
        upstream.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }, 30_000);
});
