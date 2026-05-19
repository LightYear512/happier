import { describe, expect, it } from 'vitest';

import {
  DaemonSessionDevPreviewHttpRequestSchema,
  DaemonSessionDevPreviewHttpResponseSchema,
  SessionDevPreviewSocketMachineToServerEnvelopeSchema,
  SessionDevPreviewSocketServerToMachineEnvelopeSchema,
  SessionDevPreviewTokenResponseSchema,
} from './relayV1.js';

describe('dev preview relay schemas', () => {
  it('accepts a daemon HTTP relay request scoped by routeKey', () => {
    const parsed = DaemonSessionDevPreviewHttpRequestSchema.parse({
      sessionId: 'session_1',
      machineId: 'machine_1',
      routeKey: 'route_1',
      method: 'GET',
      path: '/src/main.ts',
      search: '?v=1',
      headers: {
        accept: 'text/html',
      },
    });

    expect(parsed.routeKey).toBe('route_1');
    expect(parsed.path).toBe('/src/main.ts');
  });

  it('accepts a successful daemon HTTP relay response', () => {
    const parsed = DaemonSessionDevPreviewHttpResponseSchema.parse({
      ok: true,
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
      bodyBase64: Buffer.from('<html>preview</html>', 'utf8').toString('base64'),
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error('expected relay success');
    }
    expect(parsed.status).toBe(200);
  });

  it('accepts a preview token response', () => {
    const parsed = SessionDevPreviewTokenResponseSchema.parse({
      token: 'preview_token_1',
    });

    expect(parsed.token).toBe('preview_token_1');
  });

  it('accepts a server-to-machine websocket open envelope scoped by routeKey', () => {
    const parsed = SessionDevPreviewSocketServerToMachineEnvelopeSchema.parse({
      tunnelId: 'tunnel_1',
      kind: 'open',
      sessionId: 'session_1',
      machineId: 'machine_1',
      routeKey: 'route_1',
      path: '/@vite/client',
      search: '?v=1',
      requestedSubprotocols: ['vite-hmr'],
    });

    expect(parsed.kind).toBe('open');
    expect(parsed.routeKey).toBe('route_1');
  });

  it('accepts machine-to-server websocket binary envelopes and close codes', () => {
    const parsed = SessionDevPreviewSocketMachineToServerEnvelopeSchema.parse({
      tunnelId: 'tunnel_1',
      kind: 'binary',
      dataBase64: Buffer.from('hello preview ws', 'utf8').toString('base64'),
    });

    expect(parsed.kind).toBe('binary');

    const closed = SessionDevPreviewSocketMachineToServerEnvelopeSchema.parse({
      tunnelId: 'tunnel_1',
      kind: 'close',
      code: 1000,
      reason: 'done',
    });

    expect(closed.kind).toBe('close');
    expect(closed.code).toBe(1000);
  });
});
