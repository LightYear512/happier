import type {
  SessionDevPreviewSocketMachineToServerMessage,
  SessionDevPreviewSocketServerToMachineMessage,
} from '@happier-dev/protocol';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import type { Server } from 'socket.io';

const SESSION_DEV_PREVIEW_INTERSERVER_EVENT = 'session-dev-preview:from-machine';

export type SessionDevPreviewSocketRelayBridgeMessage = Readonly<{
  userId: string;
  machineId: string;
  payload: SessionDevPreviewSocketMachineToServerMessage;
}>;

export type SessionDevPreviewSocketRelayBridge = Readonly<{
  sendToMachine: (params: Readonly<{
    userId: string;
    machineId: string;
    payload: SessionDevPreviewSocketServerToMachineMessage;
  }>) => void;
  publishFromMachine: (params: SessionDevPreviewSocketRelayBridgeMessage) => void;
  onFromMachine: (listener: (message: SessionDevPreviewSocketRelayBridgeMessage) => void) => () => void;
}>;

export function createSessionDevPreviewSocketRelayBridge(io: Server): SessionDevPreviewSocketRelayBridge {
  const listeners = new Set<(message: SessionDevPreviewSocketRelayBridgeMessage) => void>();
  const adapter = io.of('/').adapter as { serverSideEmit?: ((...args: unknown[]) => void) | undefined };
  const supportsInterServerEmit =
    typeof adapter.serverSideEmit === 'function'
    && (adapter as { constructor?: { name?: string } }).constructor?.name !== 'Adapter';

  const notifyLocalListeners = (message: SessionDevPreviewSocketRelayBridgeMessage) => {
    for (const listener of listeners) {
      listener(message);
    }
  };

  io.on(SESSION_DEV_PREVIEW_INTERSERVER_EVENT, (message: SessionDevPreviewSocketRelayBridgeMessage) => {
    notifyLocalListeners(message);
  });

  return {
    sendToMachine: ({ userId, machineId, payload }) => {
      io.to(`machine:${machineId}:${userId}`).emit(SOCKET_RPC_EVENTS.DEV_PREVIEW_TO_MACHINE_ENVELOPE, payload);
    },
    publishFromMachine: (message) => {
      notifyLocalListeners(message);
      if (supportsInterServerEmit) {
        io.serverSideEmit(SESSION_DEV_PREVIEW_INTERSERVER_EVENT, message);
      }
    },
    onFromMachine: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
