import { SessionDevPreviewSocketMachineToServerMessageSchema } from '@happier-dev/protocol';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import { Socket } from 'socket.io';

import type { SessionDevPreviewSocketRelayBridge } from '@/app/devPreview/sessionDevPreviewSocketRelayBridge';

export function sessionDevPreviewSocketRelayHandler(
  userId: string,
  socket: Socket,
  bridge: SessionDevPreviewSocketRelayBridge,
): void {
  socket.on(SOCKET_RPC_EVENTS.DEV_PREVIEW_FROM_MACHINE_ENVELOPE, (raw: unknown) => {
    const machineId = typeof (socket.data as { machineId?: unknown })?.machineId === 'string'
      ? (socket.data as { machineId: string }).machineId
      : '';
    const clientType = (socket.data as { clientType?: unknown })?.clientType;
    if (clientType !== 'machine-scoped' || !machineId) {
      socket.emit(SOCKET_RPC_EVENTS.ERROR, {
        type: 'session-dev-preview',
        error: 'Session dev preview websocket relay requires a machine-scoped socket',
      });
      return;
    }

    const parsed = SessionDevPreviewSocketMachineToServerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      socket.emit(SOCKET_RPC_EVENTS.ERROR, {
        type: 'session-dev-preview',
        error: 'Invalid session dev preview websocket relay payload',
      });
      return;
    }

    bridge.publishFromMachine({
      userId,
      machineId,
      payload: parsed.data,
    });
  });
}
