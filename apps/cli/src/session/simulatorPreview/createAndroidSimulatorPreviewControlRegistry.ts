import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export type SimulatorPreviewControlOwner = 'ai' | 'user';

export type SimulatorPreviewTapInput = Readonly<{
  type: 'tap';
  x: number;
  y: number;
}>;

export type SimulatorPreviewNormalizedInput = Readonly<{
  type: 'tap';
  x: number;
  y: number;
}>;

export type AndroidSimulatorPreviewControlRegistry = ReturnType<typeof createAndroidSimulatorPreviewControlRegistry>;

type AndroidPreviewRegistration = Readonly<{
  sessionId: string;
  simulatorSessionId: string;
  deviceId?: string;
  deviceWidth: number;
  deviceHeight: number;
}>;

type ControlLease = Readonly<{
  leaseId: string;
  owner: SimulatorPreviewControlOwner;
  holderId?: string;
  generation: number;
  expiresAtMs: number;
}>;

type RegistryEntry = Readonly<{
  registration: AndroidPreviewRegistration;
  generation: number;
  lease: ControlLease | null;
}>;

type RunAdbInputRequest = Readonly<{
  deviceId?: string;
  input: SimulatorPreviewTapInput;
}>;

export type AndroidSimulatorPreviewControlRegistryOptions = Readonly<{
  nowMs?: () => number;
  randomId?: () => string;
  runAdbInput?: (request: RunAdbInputRequest) => Promise<void>;
}>;

const DEFAULT_LEASE_TTL_MS = 30_000;

function keyFor(sessionId: string, simulatorSessionId: string): string {
  return `${sessionId}\u0000${simulatorSessionId}`;
}

function clampNormalized(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

async function runAndroidAdbInput(request: RunAdbInputRequest): Promise<void> {
  const args = [
    ...(request.deviceId ? ['-s', request.deviceId] : []),
    'shell',
    'input',
    'tap',
    String(request.input.x),
    String(request.input.y),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn('adb', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const message = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(message || `adb input exited with ${code ?? 'unknown status'}`));
    });
  });
}

export function createAndroidSimulatorPreviewControlRegistry(
  options: AndroidSimulatorPreviewControlRegistryOptions = {},
) {
  const entries = new Map<string, RegistryEntry>();
  const nowMs = options.nowMs ?? (() => Date.now());
  const randomId = options.randomId ?? (() => randomUUID());
  const runAdbInput = options.runAdbInput ?? runAndroidAdbInput;

  return {
    registerAndroidPreview(registration: AndroidPreviewRegistration): void {
      const key = keyFor(registration.sessionId, registration.simulatorSessionId);
      const existing = entries.get(key);
      entries.set(key, {
        registration,
        generation: existing?.generation ?? 0,
        lease: existing?.lease ?? null,
      });
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
          && (!entry.lease.holderId || !input.holderId || entry.lease.holderId === input.holderId);
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
      entries.set(key, {
        ...entry,
        generation,
        lease,
      });
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
      entries.set(key, {
        ...entry,
        generation,
        lease: null,
      });
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
        return { ok: false as const, errorCode: 'lease_not_found' as const, error: 'lease_not_found' as const };
      }
      if (input.generation !== entry.generation) {
        return { ok: false as const, errorCode: 'stale_generation' as const, error: 'stale_generation' as const };
      }
      const leaseError = validateLease(entry.lease, input, nowMs());
      if (leaseError) return leaseError;

      const pixelInput: SimulatorPreviewTapInput = {
        type: 'tap',
        x: Math.round(clampNormalized(input.input.x) * entry.registration.deviceWidth),
        y: Math.round(clampNormalized(input.input.y) * entry.registration.deviceHeight),
      };
      await runAdbInput({
        ...(entry.registration.deviceId ? { deviceId: entry.registration.deviceId } : {}),
        input: pixelInput,
      });
      return { ok: true as const };
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
  if (lease.holderId && input.holderId && lease.holderId !== input.holderId) {
    return { ok: false as const, errorCode: 'lease_holder_mismatch' as const, error: 'lease_holder_mismatch' as const };
  }
  if (nowMs > lease.expiresAtMs) {
    return { ok: false as const, errorCode: 'lease_expired' as const, error: 'lease_expired' as const };
  }
  return null;
}
