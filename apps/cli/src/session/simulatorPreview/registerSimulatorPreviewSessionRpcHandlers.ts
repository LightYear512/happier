import type { RpcHandlerRegistrar } from '@/api/rpc/types';

import type {
  AndroidSimulatorPreviewControlRegistry,
  SimulatorPreviewControlOwner,
} from './createAndroidSimulatorPreviewControlRegistry';

export const SIMULATOR_PREVIEW_SESSION_RPC_METHODS = {
  CONTROL_ACQUIRE: 'session.simulatorPreview.control.acquire',
  CONTROL_RELEASE: 'session.simulatorPreview.control.release',
  INPUT_SEND: 'session.simulatorPreview.input.send',
} as const;

function normalizeId(raw: unknown): string {
  return String(raw ?? '').trim();
}

function readOwner(raw: unknown): SimulatorPreviewControlOwner | null {
  return raw === 'ai' || raw === 'user' ? raw : null;
}

function invalidInput(): Readonly<{ ok: false; errorCode: 'invalid_parameters'; error: 'invalid_parameters' }> {
  return { ok: false, errorCode: 'invalid_parameters', error: 'invalid_parameters' };
}

export function registerSimulatorPreviewSessionRpcHandlers(params: Readonly<{
  sessionId: string;
  rpcHandlerManager: RpcHandlerRegistrar;
  registry: Pick<AndroidSimulatorPreviewControlRegistry, 'acquire' | 'release' | 'sendInput'>;
}>): void {
  params.rpcHandlerManager.registerHandler(SIMULATOR_PREVIEW_SESSION_RPC_METHODS.CONTROL_ACQUIRE, async (raw: unknown) => {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const simulatorSessionId = normalizeId(input?.simulatorSessionId);
    const owner = readOwner(input?.owner);
    const holderId = normalizeId(input?.holderId);
    const leaseTtlMs = input?.leaseTtlMs;
    if (!simulatorSessionId || !owner) return invalidInput();
    return await params.registry.acquire({
      sessionId: params.sessionId,
      simulatorSessionId,
      owner,
      ...(holderId ? { holderId } : {}),
      ...(typeof leaseTtlMs === 'number' ? { leaseTtlMs } : {}),
    });
  });

  params.rpcHandlerManager.registerHandler(SIMULATOR_PREVIEW_SESSION_RPC_METHODS.CONTROL_RELEASE, async (raw: unknown) => {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const simulatorSessionId = normalizeId(input?.simulatorSessionId);
    const leaseId = normalizeId(input?.leaseId);
    const owner = readOwner(input?.owner);
    const holderId = normalizeId(input?.holderId);
    if (!simulatorSessionId || !leaseId || !owner) return invalidInput();
    return await params.registry.release({
      sessionId: params.sessionId,
      simulatorSessionId,
      leaseId,
      owner,
      ...(holderId ? { holderId } : {}),
    });
  });

  params.rpcHandlerManager.registerHandler(SIMULATOR_PREVIEW_SESSION_RPC_METHODS.INPUT_SEND, async (raw: unknown) => {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const simulatorSessionId = normalizeId(input?.simulatorSessionId);
    const leaseId = normalizeId(input?.leaseId);
    const owner = readOwner(input?.owner);
    const event = input?.input && typeof input.input === 'object' ? input.input as Record<string, unknown> : null;
    if (
      !simulatorSessionId
      || !leaseId
      || !owner
      || typeof input?.generation !== 'number'
      || event?.type !== 'tap'
      || typeof event.x !== 'number'
      || typeof event.y !== 'number'
    ) {
      return invalidInput();
    }
    return await params.registry.sendInput({
      sessionId: params.sessionId,
      simulatorSessionId,
      leaseId,
      generation: input.generation,
      owner,
      input: {
        type: 'tap',
        x: event.x,
        y: event.y,
      },
    });
  });
}
