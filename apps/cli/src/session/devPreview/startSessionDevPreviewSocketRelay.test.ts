import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import { createSessionDevPreviewRegistry } from './createSessionDevPreviewRegistry';

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
      on(event: 'close', listener: (code: number, reason: Buffer) => void): void;
    }) => void): void;
    close(callback?: (error?: Error) => void): void;
  };
};

describe('startSessionDevPreviewSocketRelay', () => {
  afterEach(() => {
    delete process.env.HAPPIER_SESSION_DEV_PREVIEW_WS_OPEN_TIMEOUT_MS;
  });

  it('opens an upstream loopback websocket by routeKey and mirrors text, binary, and close envelopes', async () => {
    const registry = createSessionDevPreviewRegistry();
    const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: () => 'vite-hmr' });
    await new Promise<void>((resolve) => {
      upstream.on('listening', () => resolve());
    });
    const receivedByUpstream: Array<string | Buffer> = [];
    upstream.on('connection', (socket) => {
      socket.on('message', (data, isBinary) => {
        receivedByUpstream.push(isBinary ? Buffer.from(data) : data.toString('utf8'));
        socket.send(isBinary ? Buffer.from(data) : `echo:${data.toString('utf8')}`);
        if (receivedByUpstream.length >= 2) {
          socket.close(1000, 'upstream-done');
        }
      });
      socket.send('hello-from-upstream');
      socket.send(Buffer.from('0102', 'hex'));
    });

    const address = upstream.address();
    if (!address) {
      throw new Error('Upstream websocket server did not bind');
    }
    const preview = await registry.register({
      sessionId: 'session_1',
      machineId: 'machine_1',
      port: address.port,
      source: 'manual',
    });

    const outbound: unknown[] = [];
    const listeners = new Set<(payload: unknown) => void>();

    const { startSessionDevPreviewSocketRelay } = await import('./startSessionDevPreviewSocketRelay');
    const stopRelay = startSessionDevPreviewSocketRelay({
      registry,
      channel: {
        onEnvelope(listener) {
          listeners.add(listener as (payload: unknown) => void);
          return () => listeners.delete(listener as (payload: unknown) => void);
        },
        sendEnvelope(payload) {
          outbound.push(payload);
        },
      },
    });

    try {
      for (const listener of listeners) {
        listener({
          envelope: {
            tunnelId: 'tunnel_1',
            kind: 'open',
            sessionId: 'session_1',
            machineId: 'machine_1',
            routeKey: preview.preview.routeKey,
            path: '/hmr',
            search: '?v=1',
            requestedSubprotocols: ['vite-hmr'],
          },
        });
      }

      await expect.poll(() => outbound.some((payload: any) => payload?.envelope?.kind === 'open')).toBe(true);
      await expect.poll(() => outbound.some((payload: any) => payload?.envelope?.kind === 'text')).toBe(true);
      await expect.poll(() => outbound.some((payload: any) => payload?.envelope?.kind === 'binary')).toBe(true);

      for (const listener of listeners) {
        listener({
          envelope: {
            tunnelId: 'tunnel_1',
            kind: 'text',
            text: 'from-browser',
          },
        });
        listener({
          envelope: {
            tunnelId: 'tunnel_1',
            kind: 'binary',
            dataBase64: Buffer.from('cafebabe', 'hex').toString('base64'),
          },
        });
      }

      await expect.poll(() => receivedByUpstream).toEqual([
        'from-browser',
        Buffer.from('cafebabe', 'hex'),
      ]);
      await expect.poll(() => outbound.some((payload: any) => payload?.envelope?.kind === 'close')).toBe(true);

      expect(outbound).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            envelope: expect.objectContaining({
              kind: 'open',
              acceptedSubprotocol: 'vite-hmr',
            }),
          }),
          expect.objectContaining({
            envelope: expect.objectContaining({
              kind: 'text',
              text: 'hello-from-upstream',
            }),
          }),
          expect.objectContaining({
            envelope: expect.objectContaining({
              kind: 'binary',
              dataBase64: Buffer.from('0102', 'hex').toString('base64'),
            }),
          }),
          expect.objectContaining({
            envelope: expect.objectContaining({
              kind: 'text',
              text: 'echo:from-browser',
            }),
          }),
          expect.objectContaining({
            envelope: expect.objectContaining({
              kind: 'binary',
              dataBase64: Buffer.from('cafebabe', 'hex').toString('base64'),
            }),
          }),
          expect.objectContaining({
            envelope: expect.objectContaining({
              kind: 'close',
              code: 1000,
              reason: 'upstream-done',
            }),
          }),
        ]),
      );
    } finally {
      stopRelay();
      await new Promise<void>((resolve, reject) => {
        upstream.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
