import { randomUUID } from 'node:crypto';

import type {
  SimulatorPreviewControlOwner,
  SimulatorPreviewNormalizedInput,
} from './createAndroidSimulatorPreviewControlRegistry';
import { createIosWebDriverAgentInputBridge } from './createIosWebDriverAgentInputBridge';

export type IosSimulatorPreviewControlRegistry = ReturnType<typeof createIosSimulatorPreviewControlRegistry>;

type IosPreviewRegistration = Readonly<{
  sessionId: string;
  simulatorSessionId: string;
  deviceId?: string;
  wdaUrl?: string;
}>;

type ControlLease = Readonly<{
  leaseId: string;
  owner: SimulatorPreviewControlOwner;
  holderId?: string;
  generation: number;
  expiresAtMs: number;
}>;

type RegistryEntry = Readonly<{
  registration: IosPreviewRegistration;
  generation: number;
  lease: ControlLease | null;
  inputTimeline: readonly IosSimulatorPreviewInputTimelineEntry[];
}>;

type IosInputErrorCode =
  | 'lease_not_found'
  | 'stale_generation'
  | 'invalid_lease'
  | 'lease_owner_mismatch'
  | 'lease_holder_mismatch'
  | 'lease_expired'
  | 'ios_input_failed';

type SendIosInputRequest = Readonly<{
  deviceId?: string;
  wdaUrl?: string;
  input: SimulatorPreviewNormalizedInput;
}>;

export type IosSimulatorPreviewInputTimelineEntry = Readonly<{
  atMs: number;
  accepted: boolean;
  owner: SimulatorPreviewControlOwner;
  holderId?: string;
  generation: number;
  input: SimulatorPreviewNormalizedInput;
  errorCode?: IosInputErrorCode;
}>;

export type IosSimulatorPreviewControlRegistryOptions = Readonly<{
  nowMs?: () => number;
  randomId?: () => string;
  sendIosInput?: (request: SendIosInputRequest) => Promise<Readonly<{ ok: true } | { ok: false; errorCode: string; error: string }>>;
}>;

const DEFAULT_LEASE_TTL_MS = 30_000;

function keyFor(sessionId: string, simulatorSessionId: string): string {
  return `${sessionId}\u0000${simulatorSessionId}`;
}

export function createIosSimulatorPreviewControlRegistry(
  options: IosSimulatorPreviewControlRegistryOptions = {},
) {
  const entries = new Map<string, RegistryEntry>();
  const nowMs = options.nowMs ?? (() => Date.now());
  const randomId = options.randomId ?? (() => randomUUID());
  const bridge = createIosWebDriverAgentInputBridge();
  const sendIosInput = options.sendIosInput ?? (async (request: SendIosInputRequest) => await bridge.sendInput(request));

  return {
    registerIosPreview(registration: IosPreviewRegistration): void {
      const key = keyFor(registration.sessionId, registration.simulatorSessionId);
      const existing = entries.get(key);
      entries.set(key, {
        registration,
        generation: existing?.generation ?? 0,
        lease: existing?.lease ?? null,
        inputTimeline: existing?.inputTimeline ?? [],
      });
    },

    clearSessionPreviews(input: Readonly<{
      sessionId: string;
      excludeSimulatorSessionId?: string;
    }>): void {
      for (const [key, entry] of entries) {
        if (
          entry.registration.sessionId === input.sessionId
          && entry.registration.simulatorSessionId !== input.excludeSimulatorSessionId
        ) {
          entries.delete(key);
        }
      }
    },

    async acquire(input: Readonly<{
      sessionId: string;
      simulatorSessionId: string;
      owner: SimulatorPreviewControlOwner;
      holderId?: string;
      leaseTtlMs?: number;
    }>) {
      const key = keyFor(input.sessionId, input.simulatorSessionId);
      const entry = entries.get(key);
      if (!entry) {
        return { ok: false as const, errorCode: 'simulator_preview_not_found' as const, error: 'simulator_preview_not_found' as const };
      }
      if (entry.lease && nowMs() <= entry.lease.expiresAtMs) {
        const sameHolder = entry.lease.owner === input.owner
          && (!entry.lease.holderId || entry.lease.holderId === input.holderId);
        if (!sameHolder) {
          return {
            ok: false as const,
            errorCode: 'control_busy' as const,
            error: 'control_busy' as const,
            owner: entry.lease.owner,
          };
        }
      }
      const generation = entry.generation + 1;
      const lease: ControlLease = {
        leaseId: randomId(),
        owner: input.owner,
        ...(input.holderId ? { holderId: input.holderId } : {}),
        generation,
        expiresAtMs: nowMs() + (input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS),
      };
      entries.set(key, { ...entry, generation, lease });
      return {
        ok: true as const,
        leaseId: lease.leaseId,
        owner: lease.owner,
        ...(lease.holderId ? { holderId: lease.holderId } : {}),
        generation,
        expiresAtMs: lease.expiresAtMs,
        mode: input.owner === 'user' ? 'user_control' as const : 'ai_control' as const,
      };
    },

    async release(input: Readonly<{
      sessionId: string;
      simulatorSessionId: string;
      leaseId: string;
      owner: SimulatorPreviewControlOwner;
      holderId?: string;
    }>) {
      const key = keyFor(input.sessionId, input.simulatorSessionId);
      const entry = entries.get(key);
      if (!entry?.lease) {
        return { ok: false as const, errorCode: 'lease_not_found' as const, error: 'lease_not_found' as const };
      }
      const leaseError = validateLease(entry.lease, input, nowMs());
      if (leaseError) return leaseError;
      const generation = entry.generation + 1;
      entries.set(key, { ...entry, generation, lease: null });
      return { ok: true as const, generation, mode: 'idle' as const };
    },

    async sendInput(input: Readonly<{
      sessionId: string;
      simulatorSessionId: string;
      leaseId: string;
      generation: number;
      owner: SimulatorPreviewControlOwner;
      holderId?: string;
      input: SimulatorPreviewNormalizedInput;
    }>) {
      const key = keyFor(input.sessionId, input.simulatorSessionId);
      const entry = entries.get(key);
      if (!entry?.lease) {
        if (entry) recordInputTimeline(entries, key, entry, input, nowMs(), false, 'lease_not_found');
        return { ok: false as const, errorCode: 'lease_not_found' as const, error: 'lease_not_found' as const };
      }
      if (input.generation !== entry.generation) {
        recordInputTimeline(entries, key, entry, input, nowMs(), false, 'stale_generation');
        return { ok: false as const, errorCode: 'stale_generation' as const, error: 'stale_generation' as const };
      }
      const leaseError = validateLease(entry.lease, input, nowMs());
      if (leaseError) {
        recordInputTimeline(entries, key, entry, input, nowMs(), false, leaseError.errorCode);
        return leaseError;
      }
      try {
        const result = await sendIosInput({
          ...(entry.registration.deviceId ? { deviceId: entry.registration.deviceId } : {}),
          ...(entry.registration.wdaUrl ? { wdaUrl: entry.registration.wdaUrl } : {}),
          input: input.input,
        });
        if (!result.ok) return result;
      } catch (error) {
        recordInputTimeline(entries, key, entry, input, nowMs(), false, 'ios_input_failed');
        throw error;
      }
      recordInputTimeline(entries, key, entry, input, nowMs(), true);
      return { ok: true as const };
    },

    async reloadApp(_input?: unknown) {
      return { ok: false as const, errorCode: 'unsupported_ios_operation' as const, error: 'unsupported_ios_operation' as const };
    },

    async reconnectDevServices(_input?: unknown) {
      return { ok: true as const, reconnectedPorts: [] as number[] };
    },

    listInputTimeline(input: Readonly<{
      sessionId: string;
      simulatorSessionId: string;
    }>): readonly IosSimulatorPreviewInputTimelineEntry[] {
      return [...(entries.get(keyFor(input.sessionId, input.simulatorSessionId))?.inputTimeline ?? [])];
    },
  };
}

function validateLease(
  lease: ControlLease,
  input: Readonly<{
    leaseId: string;
    owner: SimulatorPreviewControlOwner;
    holderId?: string;
  }>,
  nowMs: number,
) {
  if (lease.leaseId !== input.leaseId) {
    return { ok: false as const, errorCode: 'invalid_lease' as const, error: 'invalid_lease' as const };
  }
  if (lease.owner !== input.owner) {
    return { ok: false as const, errorCode: 'lease_owner_mismatch' as const, error: 'lease_owner_mismatch' as const };
  }
  if (lease.holderId && lease.holderId !== input.holderId) {
    return { ok: false as const, errorCode: 'lease_holder_mismatch' as const, error: 'lease_holder_mismatch' as const };
  }
  if (nowMs > lease.expiresAtMs) {
    return { ok: false as const, errorCode: 'lease_expired' as const, error: 'lease_expired' as const };
  }
  return null;
}

function recordInputTimeline(
  entries: Map<string, RegistryEntry>,
  key: string,
  entry: RegistryEntry,
  request: Readonly<{
    generation: number;
    owner: SimulatorPreviewControlOwner;
    holderId?: string;
    input: SimulatorPreviewNormalizedInput;
  }>,
  atMs: number,
  accepted: boolean,
  errorCode?: IosInputErrorCode,
): void {
  entries.set(key, {
    ...entry,
    inputTimeline: [
      ...entry.inputTimeline,
      {
        atMs,
        accepted,
        owner: request.owner,
        ...(request.holderId ? { holderId: request.holderId } : {}),
        generation: request.generation,
        input: request.input,
        ...(errorCode ? { errorCode } : {}),
      },
    ],
  });
}
