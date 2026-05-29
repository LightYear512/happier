import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { parseHostNamespacePreviewHost, resolvePreviewHostHeader } from '@/app/devPreview/previewHostNamespace';

const require = createRequire(import.meta.url);

export type PreviewRelayUpgradeRequest = IncomingMessage & {
  __happierAcceptedProtocol?: string | undefined;
};

export type PreviewRelayWebSocket = {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): void;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): void;
};

type PreviewRelayWebSocketServer = {
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (websocket: PreviewRelayWebSocket) => void,
  ): void;
};

const { WebSocketServer } = require('ws') as {
  WebSocketServer: new (options: {
    noServer: true;
    handleProtocols?: (protocols: Set<string>, request: IncomingMessage) => string | false;
  }) => PreviewRelayWebSocketServer;
};

const DEFAULT_PREVIEW_WS_OPEN_TIMEOUT_MS = 10_000;

export function createPreviewRelayWebSocketServer(): PreviewRelayWebSocketServer {
  return new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols, request) => {
      const acceptedProtocol = (request as PreviewRelayUpgradeRequest).__happierAcceptedProtocol;
      if (!acceptedProtocol) {
        return false;
      }
      return protocols.has(acceptedProtocol) ? acceptedProtocol : false;
    },
  });
}

export function resolvePreviewWsOpenTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = (env.HAPPIER_SESSION_DEV_PREVIEW_WS_OPEN_TIMEOUT_MS ?? '').trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 250) {
    return DEFAULT_PREVIEW_WS_OPEN_TIMEOUT_MS;
  }
  return Math.min(parsed, 120_000);
}

export function readRequestedSubprotocols(request: IncomingMessage): string[] {
  const raw = typeof request.headers['sec-websocket-protocol'] === 'string'
    ? request.headers['sec-websocket-protocol']
    : '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function matchPreviewRouteRequest(rawUrl: string): null | Readonly<{
  sessionId: string;
  machineId: string;
  routeKey: string;
  path: string;
  search: string;
  hostId?: string;
}> {
  const parsed = new URL(rawUrl, 'http://127.0.0.1');
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 4 || segments[0] !== 'preview') {
    return null;
  }

  const [_, rawSessionId, rawMachineId, rawRouteKey, ...rest] = segments;
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  };

  const sessionId = decode(rawSessionId);
  const machineId = decode(rawMachineId);
  const routeKey = decode(rawRouteKey);
  if (!sessionId || !machineId || !routeKey) {
    return null;
  }

  return {
    sessionId,
    machineId,
    routeKey,
    hostId: undefined,
    path: rest.length > 0 ? `/${rest.join('/')}` : '/',
    search: parsed.search,
  };
}

export function matchHostNamespacePreviewRequest(
  request: IncomingMessage,
  env: NodeJS.ProcessEnv = process.env,
): null | Readonly<{
  sessionId: string;
  machineId: string;
  routeKey: string;
  path: string;
  search: string;
  hostId?: string;
}> {
  const parsedHost = parseHostNamespacePreviewHost(resolvePreviewHostHeader(request.headers), env);
  if (!parsedHost) {
    return null;
  }
  const parsed = new URL(request.url ?? '/', 'http://127.0.0.1');
  return {
    sessionId: '',
    machineId: '',
    routeKey: '',
    hostId: parsedHost.hostId,
    path: parsed.pathname || '/',
    search: parsed.search,
  };
}

export function writeUpgradeRejection(socket: Duplex, statusCode: number, error: string): void {
  if (socket.destroyed) {
    return;
  }

  const body = JSON.stringify({ error });
  const statusText =
    statusCode === 401 ? 'Unauthorized'
      : statusCode === 403 ? 'Forbidden'
        : statusCode === 404 ? 'Not Found'
          : statusCode === 503 ? 'Service Unavailable'
            : 'Bad Gateway';
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n`
    + 'Connection: close\r\n'
    + 'Content-Type: application/json; charset=utf-8\r\n'
    + `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n`
    + '\r\n'
    + body,
  );
  socket.destroy();
}
