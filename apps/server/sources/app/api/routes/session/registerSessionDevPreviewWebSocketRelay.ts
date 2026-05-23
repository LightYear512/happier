import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';

import { type SessionDevPreviewSocketRelayBridgeMessage } from '@/app/devPreview/sessionDevPreviewSocketRelayBridge';
import { hasOwnerPreviewAccess, parsePreviewTokenFromRequest } from '@/app/devPreview/sessionDevPreviewRequestAuth';
import { isServerFeatureEnabledForRequest } from '@/app/features/catalog/serverFeatureGate';
import { type Fastify } from '@/app/api/types';
import { SessionDevPreviewSocketServerToMachineMessageSchema } from '@happier-dev/protocol';
import { verifySessionDevPreviewToken } from './sessionDevPreviewToken';
import {
  createPreviewRelayWebSocketServer,
  matchHostNamespacePreviewRequest,
  matchPreviewRouteRequest,
  readRequestedSubprotocols,
  resolvePreviewWsOpenTimeoutMs,
  type PreviewRelayUpgradeRequest,
  type PreviewRelayWebSocket,
  writeUpgradeRejection,
} from './sessionDevPreviewWebSocketUpgrade';

type PendingTunnel = Readonly<{
  tunnelId: string;
  userId: string;
  machineId: string;
  requestedSubprotocols: readonly string[];
  request: PreviewRelayUpgradeRequest;
  socket: Duplex;
  head: Buffer;
  timeout: NodeJS.Timeout;
}>;

type ActiveTunnel = Readonly<{
  tunnelId: string;
  userId: string;
  machineId: string;
  websocket: PreviewRelayWebSocket;
}>;

export function registerSessionDevPreviewWebSocketRelay(app: Fastify): void {
  const server = app.server;
  if (!server || typeof server.on !== 'function') {
    return;
  }

  const pendingTunnels = new Map<string, PendingTunnel>();
  const activeTunnels = new Map<string, ActiveTunnel>();
  const openTimeoutMs = resolvePreviewWsOpenTimeoutMs(process.env);
  let bridgeUnsubscribe: (() => void) | null = null;

  const wss = createPreviewRelayWebSocketServer();

  function removePendingTunnel(tunnelId: string): PendingTunnel | null {
    const pending = pendingTunnels.get(tunnelId) ?? null;
    if (!pending) {
      return null;
    }
    clearTimeout(pending.timeout);
    pendingTunnels.delete(tunnelId);
    return pending;
  }

  function ensureBridgeListener(): boolean {
    if (bridgeUnsubscribe) {
      return true;
    }
    if (!app.sessionDevPreviewSocketRelay) {
      return false;
    }

    bridgeUnsubscribe = app.sessionDevPreviewSocketRelay.onFromMachine((message: SessionDevPreviewSocketRelayBridgeMessage) => {
      const tunnelId = message.payload.envelope.tunnelId;
      const pending = pendingTunnels.get(tunnelId);
      if (pending) {
        if (pending.userId !== message.userId || pending.machineId !== message.machineId) {
          return;
        }

        if (message.payload.envelope.kind === 'open') {
          if (
            message.payload.envelope.acceptedSubprotocol
            && !pending.requestedSubprotocols.includes(message.payload.envelope.acceptedSubprotocol)
          ) {
            const doomed = removePendingTunnel(tunnelId);
            if (doomed) {
              writeUpgradeRejection(doomed.socket, 502, 'invalid-preview-relay-response');
            }
            return;
          }

          pending.request.__happierAcceptedProtocol = message.payload.envelope.acceptedSubprotocol;
          const doomed = removePendingTunnel(tunnelId);
          if (!doomed) {
            return;
          }

          wss.handleUpgrade(doomed.request, doomed.socket, doomed.head, (websocket) => {
            const activeTunnel: ActiveTunnel = {
              tunnelId,
              userId: doomed.userId,
              machineId: doomed.machineId,
              websocket,
            };
            activeTunnels.set(tunnelId, activeTunnel);

            websocket.on('message', (data, isBinary) => {
              app.sessionDevPreviewSocketRelay?.sendToMachine({
                userId: activeTunnel.userId,
                machineId: activeTunnel.machineId,
                payload: {
                  envelope: isBinary
                    ? {
                        tunnelId,
                        kind: 'binary',
                        dataBase64: Buffer.from(data).toString('base64'),
                      }
                    : {
                        tunnelId,
                        kind: 'text',
                        text: data.toString('utf8'),
                      },
                },
              });
            });

            websocket.on('close', (code, reason) => {
              if (!activeTunnels.delete(tunnelId)) {
                return;
              }
              app.sessionDevPreviewSocketRelay?.sendToMachine({
                userId: activeTunnel.userId,
                machineId: activeTunnel.machineId,
                payload: {
                  envelope: {
                    tunnelId,
                    kind: 'close',
                    ...(typeof code === 'number' ? { code } : {}),
                    ...(reason.length > 0 ? { reason: reason.toString('utf8') } : {}),
                  },
                },
              });
            });
          });
          return;
        }

        const doomed = removePendingTunnel(tunnelId);
        if (doomed) {
          writeUpgradeRejection(doomed.socket, 502, message.payload.envelope.kind === 'error' ? message.payload.envelope.reason : 'preview-relay-unavailable');
        }
        return;
      }

      const active = activeTunnels.get(tunnelId);
      if (!active || active.userId !== message.userId || active.machineId !== message.machineId) {
        return;
      }

      if (message.payload.envelope.kind === 'text') {
        active.websocket.send(message.payload.envelope.text);
        return;
      }
      if (message.payload.envelope.kind === 'binary') {
        active.websocket.send(Buffer.from(message.payload.envelope.dataBase64, 'base64'));
        return;
      }
      if (message.payload.envelope.kind === 'close') {
        activeTunnels.delete(tunnelId);
        active.websocket.close(message.payload.envelope.code, message.payload.envelope.reason);
        return;
      }
      if (message.payload.envelope.kind === 'error') {
        activeTunnels.delete(tunnelId);
        active.websocket.close(1011, message.payload.envelope.reason);
      }
    });

    return true;
  }

  server.on('upgrade', async (request, socket, head) => {
    const matched = matchPreviewRouteRequest(request.url ?? '/') ?? matchHostNamespacePreviewRequest(request, process.env);
    if (!matched) {
      return;
    }

    if (!isServerFeatureEnabledForRequest('sessions.devPreview.relay', process.env)) {
      writeUpgradeRejection(socket, 404, 'not_found');
      return;
    }

    if (!ensureBridgeListener()) {
      writeUpgradeRejection(socket, 503, 'preview-relay-unavailable');
      return;
    }
    const bridge = app.sessionDevPreviewSocketRelay;
    if (!bridge) {
      writeUpgradeRejection(socket, 503, 'preview-relay-unavailable');
      return;
    }

    const tokenContext = parsePreviewTokenFromRequest({
      raw: { url: request.url ?? '/' },
      headers: request.headers as Record<string, unknown>,
    });
    if (!tokenContext.previewToken) {
      writeUpgradeRejection(socket, 401, 'invalid-preview-token');
      return;
    }

    const verifiedToken = await verifySessionDevPreviewToken(tokenContext.previewToken);
    if (!verifiedToken) {
      writeUpgradeRejection(socket, 401, 'invalid-preview-token');
      return;
    }
    if (
      verifiedToken.sessionId !== matched.sessionId
      || verifiedToken.machineId !== matched.machineId
      || verifiedToken.routeKey !== matched.routeKey
    ) {
      writeUpgradeRejection(socket, 403, 'preview-token-scope-mismatch');
      return;
    }

    const hasAccess = await hasOwnerPreviewAccess({
      userId: verifiedToken.userId,
      sessionId: matched.sessionId,
      machineId: matched.machineId,
    });
    if (!hasAccess) {
      writeUpgradeRejection(socket, 404, 'not_found');
      return;
    }

    const requestedSubprotocols = readRequestedSubprotocols(request);
    const tunnelId = randomUUID();
    const openPayload = SessionDevPreviewSocketServerToMachineMessageSchema.parse({
      envelope: {
        tunnelId,
        kind: 'open',
        sessionId: matched.sessionId,
        machineId: matched.machineId,
        routeKey: matched.routeKey,
        path: matched.path,
        search: tokenContext.forwardedSearch,
        ...(requestedSubprotocols.length > 0 ? { requestedSubprotocols } : {}),
      },
    });

    const timeout = setTimeout(() => {
      const doomed = removePendingTunnel(tunnelId);
      if (!doomed) {
        return;
      }
      writeUpgradeRejection(doomed.socket, 502, 'preview-relay-timeout');
    }, openTimeoutMs);

    const pendingTunnel: PendingTunnel = {
      tunnelId,
      userId: verifiedToken.userId,
      machineId: matched.machineId,
      requestedSubprotocols,
      request: request as PreviewRelayUpgradeRequest,
      socket,
      head,
      timeout,
    };
    pendingTunnels.set(tunnelId, pendingTunnel);

    socket.once('close', () => {
      const doomed = removePendingTunnel(tunnelId);
      if (!doomed) {
        return;
      }
      bridge.sendToMachine({
        userId: doomed.userId,
        machineId: doomed.machineId,
        payload: {
          envelope: {
            tunnelId,
            kind: 'close',
            code: 1001,
            reason: 'client_disconnected',
          },
        },
      });
    });

    bridge.sendToMachine({
      userId: verifiedToken.userId,
      machineId: matched.machineId,
      payload: openPayload,
    });
  });
}
