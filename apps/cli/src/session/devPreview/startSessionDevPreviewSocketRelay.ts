import type {
  SessionDevPreviewSocketMachineToServerMessage,
  SessionDevPreviewSocketServerToMachineMessage,
} from '@happier-dev/protocol';

import type { SessionDevPreviewRegistry } from './createSessionDevPreviewRegistry';

type SessionDevPreviewSocketRelayChannel = Readonly<{
  onEnvelope: (listener: (payload: SessionDevPreviewSocketServerToMachineMessage) => void) => () => void;
  sendEnvelope: (payload: SessionDevPreviewSocketMachineToServerMessage) => void;
}>;

type ActiveTunnel = {
  socket: WebSocket;
  isClosed: boolean;
};

const DEFAULT_SESSION_DEV_PREVIEW_WS_OPEN_TIMEOUT_MS = 10_000;

function resolveSessionDevPreviewWsOpenTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = (env.HAPPIER_SESSION_DEV_PREVIEW_WS_OPEN_TIMEOUT_MS ?? '').trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 250) {
    return DEFAULT_SESSION_DEV_PREVIEW_WS_OPEN_TIMEOUT_MS;
  }
  return Math.min(parsed, 120_000);
}

function buildLoopbackWebSocketUrl(params: Readonly<{
  port: number;
  path: string;
  search?: string;
}>): string {
  const url = new URL(`ws://127.0.0.1:${params.port}/`);
  url.pathname = params.path.startsWith('/') ? params.path : `/${params.path}`;
  url.search = params.search ?? '';
  return url.toString();
}

async function readWebSocketMessageDataAsBuffer(data: unknown): Promise<Buffer> {
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  return Buffer.from(String(data ?? ''), 'utf8');
}

function closeTunnelSocket(tunnel: ActiveTunnel | undefined, code?: number, reason?: string): void {
  if (!tunnel || tunnel.isClosed) {
    return;
  }
  tunnel.isClosed = true;
  const normalizedCode = code === 1000 || (typeof code === 'number' && code >= 3000 && code <= 4999)
    ? code
    : 1000;
  tunnel.socket.close(normalizedCode, reason);
}

export function startSessionDevPreviewSocketRelay(params: Readonly<{
  registry: SessionDevPreviewRegistry;
  channel: SessionDevPreviewSocketRelayChannel;
  deps?: Readonly<{
    env?: NodeJS.ProcessEnv;
    webSocketFactory?: (url: string, protocols?: string[]) => WebSocket;
  }>;
}>): () => void {
  const env = params.deps?.env ?? process.env;
  const webSocketFactory = params.deps?.webSocketFactory ?? ((url: string, protocols?: string[]) => new WebSocket(url, protocols));
  const openTimeoutMs = resolveSessionDevPreviewWsOpenTimeoutMs(env);
  const activeTunnels = new Map<string, ActiveTunnel>();

  const unsubscribe = params.channel.onEnvelope((payload) => {
    const envelope = payload.envelope;

    if (envelope.kind === 'open') {
      const preview = params.registry.getByRouteKey(envelope.routeKey);
      if (!preview || preview.sessionId !== envelope.sessionId || preview.machineId !== envelope.machineId) {
        params.channel.sendEnvelope({
          envelope: {
            tunnelId: envelope.tunnelId,
            kind: 'error',
            reason: 'preview_not_found',
          },
        });
        return;
      }
      if (preview.health.status === 'dead') {
        params.channel.sendEnvelope({
          envelope: {
            tunnelId: envelope.tunnelId,
            kind: 'error',
            reason: 'preview_dead',
          },
        });
        return;
      }

      const socket = webSocketFactory(
        buildLoopbackWebSocketUrl({
          port: preview.port,
          path: envelope.path,
          search: envelope.search,
        }),
        envelope.requestedSubprotocols,
      );
      const tunnel: ActiveTunnel = {
        socket,
        isClosed: false,
      };
      activeTunnels.set(envelope.tunnelId, tunnel);
      const openTimeout = setTimeout(() => {
        if (!activeTunnels.has(envelope.tunnelId)) {
          return;
        }
        activeTunnels.delete(envelope.tunnelId);
        params.channel.sendEnvelope({
          envelope: {
            tunnelId: envelope.tunnelId,
            kind: 'error',
            reason: 'preview_connect_timeout',
          },
        });
        closeTunnelSocket(tunnel, 4008, 'preview_connect_timeout');
      }, openTimeoutMs);

      const cleanup = () => {
        clearTimeout(openTimeout);
        activeTunnels.delete(envelope.tunnelId);
        tunnel.isClosed = true;
      };

      socket.binaryType = 'arraybuffer';
      socket.addEventListener('open', () => {
        clearTimeout(openTimeout);
        params.channel.sendEnvelope({
          envelope: {
            tunnelId: envelope.tunnelId,
            kind: 'open',
            ...(socket.protocol ? { acceptedSubprotocol: socket.protocol } : {}),
          },
        });
      });
      socket.addEventListener('message', (event) => {
        void (async () => {
          if (typeof event.data === 'string') {
            params.channel.sendEnvelope({
              envelope: {
                tunnelId: envelope.tunnelId,
                kind: 'text',
                text: event.data,
              },
            });
            return;
          }

          const bytes = await readWebSocketMessageDataAsBuffer(event.data);
          params.channel.sendEnvelope({
            envelope: {
              tunnelId: envelope.tunnelId,
              kind: 'binary',
              dataBase64: bytes.toString('base64'),
            },
          });
        })();
      });
      socket.addEventListener('close', (event) => {
        cleanup();
        params.channel.sendEnvelope({
          envelope: {
            tunnelId: envelope.tunnelId,
            kind: 'close',
            ...(typeof event.code === 'number' ? { code: event.code } : {}),
            ...(event.reason ? { reason: event.reason } : {}),
          },
        });
      });
      socket.addEventListener('error', () => {
        if (!activeTunnels.has(envelope.tunnelId)) {
          return;
        }
        cleanup();
        params.channel.sendEnvelope({
          envelope: {
            tunnelId: envelope.tunnelId,
            kind: 'error',
            reason: 'preview_connect_failed',
          },
        });
      });
      return;
    }

    const tunnel = activeTunnels.get(envelope.tunnelId);
    if (!tunnel) {
      return;
    }

    if (envelope.kind === 'text') {
      tunnel.socket.send(envelope.text);
      return;
    }

    if (envelope.kind === 'binary') {
      tunnel.socket.send(Buffer.from(envelope.dataBase64, 'base64'));
      return;
    }

    if (envelope.kind === 'close') {
      activeTunnels.delete(envelope.tunnelId);
      closeTunnelSocket(tunnel, envelope.code, envelope.reason);
    }
  });

  return () => {
    unsubscribe();
    for (const tunnel of activeTunnels.values()) {
      closeTunnelSocket(tunnel, 4001, 'daemon_shutdown');
    }
    activeTunnels.clear();
  };
}
