import { describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';

import {
  createSessionDevPreviewSocketRelayBridge,
  type SessionDevPreviewSocketRelayBridgeMessage,
} from './sessionDevPreviewSocketRelayBridge';

function createSocketIoHarness(params: Readonly<{
  adapterName?: string;
  serverSideEmit?: (...args: unknown[]) => void;
}>): Server {
  const listeners = new Map<string, (message: SessionDevPreviewSocketRelayBridgeMessage) => void>();
  const io = {
    on: vi.fn((event: string, listener: (message: SessionDevPreviewSocketRelayBridgeMessage) => void) => {
      listeners.set(event, listener);
    }),
    of: vi.fn(() => ({
      adapter: {
        constructor: { name: params.adapterName ?? 'RedisStreamsAdapter' },
        ...(params.serverSideEmit ? { serverSideEmit: params.serverSideEmit } : {}),
      },
    })),
    serverSideEmit: params.serverSideEmit,
    to: vi.fn(() => ({ emit: vi.fn() })),
  };

  // Boundary fixture: the bridge intentionally depends on a narrow Socket.IO surface.
  return io as unknown as Server;
}

describe('createSessionDevPreviewSocketRelayBridge', () => {
  it('publishes machine messages to cluster peers and local websocket relay listeners', () => {
    const serverSideEmit = vi.fn();
    const io = createSocketIoHarness({ serverSideEmit });
    const bridge = createSessionDevPreviewSocketRelayBridge(io);
    const listener = vi.fn();
    bridge.onFromMachine(listener);

    const message = {
      userId: 'acct_1',
      machineId: 'machine_1',
      payload: {
        envelope: {
          tunnelId: 'tunnel_1',
          kind: 'text',
          text: 'hello',
        },
      },
    } satisfies SessionDevPreviewSocketRelayBridgeMessage;

    bridge.publishFromMachine(message);

    expect(serverSideEmit).toHaveBeenCalledWith('session-dev-preview:from-machine', message);
    expect(listener).toHaveBeenCalledWith(message);
  });
});
