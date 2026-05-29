import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { getActionSpec } from '@happier-dev/protocol';

import type {
  AndroidSimulatorPreviewControlRegistry,
  SimulatorPreviewControlOwner,
  SimulatorPreviewNormalizedInput,
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

type SimulatorPreviewInputSendRpcPayload = Readonly<{
  simulatorSessionId: string;
  leaseId: string;
  generation: number;
  owner: SimulatorPreviewControlOwner;
  holderId?: string;
  input: SimulatorPreviewNormalizedInput;
}>;

const SimulatorPreviewInputSendSchema = getActionSpec('session.simulatorPreview.input.send').inputSchema;

function readInputSendPayload(raw: unknown): SimulatorPreviewInputSendRpcPayload | null {
  const parsed = SimulatorPreviewInputSendSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data as SimulatorPreviewInputSendRpcPayload;
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
    const input = readInputSendPayload(raw);
    if (!input) return invalidInput();
    const holderId = normalizeId(input.holderId);
    return await params.registry.sendInput({
      sessionId: params.sessionId,
      simulatorSessionId: input.simulatorSessionId,
      leaseId: input.leaseId,
      generation: input.generation,
      owner: input.owner,
      ...(holderId ? { holderId } : {}),
      input: input.input,
    });
  });
}
