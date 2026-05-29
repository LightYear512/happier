import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import type { SimulatorPreviewV1 } from '@happier-dev/protocol';

export type SimulatorPreviewControlOwner = 'ai' | 'user';

export type SimulatorPreviewTapInput = Readonly<{
  type: 'tap';
  x: number;
  y: number;
}>;

export type SimulatorPreviewSwipeInput = Readonly<{
  type: 'swipe';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
}>;

export type SimulatorPreviewTextInput = Readonly<{
  type: 'text';
  text: string;
}>;

export type SimulatorPreviewKeyeventInput = Readonly<{
  type: 'keyevent';
  key: 'back' | 'home' | 'enter';
}>;

export type SimulatorPreviewNormalizedInput =
  | SimulatorPreviewTapInput
  | SimulatorPreviewSwipeInput
  | SimulatorPreviewTextInput
  | SimulatorPreviewKeyeventInput;

type SimulatorPreviewDeviceInput = SimulatorPreviewNormalizedInput;
type SimulatorPreviewDeviceKeyeventInput = Readonly<{
  type: 'keyevent';
  key: SimulatorPreviewKeyeventInput['key'] | 'reload_app';
}>;
type AndroidAdbInput = Exclude<SimulatorPreviewDeviceInput, SimulatorPreviewKeyeventInput> | SimulatorPreviewDeviceKeyeventInput;

type SimulatorPreviewInputErrorCode =
  | 'lease_not_found'
  | 'stale_generation'
  | 'invalid_lease'
  | 'lease_owner_mismatch'
  | 'lease_holder_mismatch'
  | 'lease_expired'
  | 'adb_input_failed';

export type SimulatorPreviewInputTimelineEntry = Readonly<{
  atMs: number;
  accepted: boolean;
  owner: SimulatorPreviewControlOwner;
  holderId?: string;
  generation: number;
  input: SimulatorPreviewNormalizedInput;
  errorCode?: SimulatorPreviewInputErrorCode;
}>;

export type AndroidSimulatorPreviewControlRegistry = ReturnType<typeof createAndroidSimulatorPreviewControlRegistry>;

type AndroidPreviewRegistration = Readonly<{
  sessionId: string;
  simulatorSessionId: string;
  deviceId?: string;
  deviceWidth: number;
  deviceHeight: number;
  devServices?: SimulatorPreviewV1['devServices'];
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
  inputTimeline: readonly SimulatorPreviewInputTimelineEntry[];
}>;

type RunAdbInputRequest = Readonly<{
  deviceId?: string;
  input: AndroidAdbInput;
}>;

type RunAdbReverseRequest = Readonly<{
  deviceId?: string;
  devicePort: number;
  hostPort: number;
}>;

export type AndroidSimulatorPreviewControlRegistryOptions = Readonly<{
  nowMs?: () => number;
  randomId?: () => string;
  runAdbInput?: (request: RunAdbInputRequest) => Promise<void>;
  runAdbReverse?: (request: RunAdbReverseRequest) => Promise<void>;
}>;

const DEFAULT_LEASE_TTL_MS = 30_000;

function keyFor(sessionId: string, simulatorSessionId: string): string {
  return `${sessionId}\u0000${simulatorSessionId}`;
}

function clampNormalized(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function escapeAdbInputText(text: string): string {
  let escaped = '';
  for (const char of text) {
    if (/\s/u.test(char)) {
      escaped += '%s';
    } else if (char === '%') {
      escaped += '%25';
    } else if (/["'\\&|;<>()$`*?\[\]{}~!#]/u.test(char)) {
      escaped += `\\${char}`;
    } else {
      escaped += char;
    }
  }
  return escaped;
}

function mapKeyevent(key: SimulatorPreviewDeviceKeyeventInput['key']): string {
  if (key === 'back') return 'KEYCODE_BACK';
  if (key === 'home') return 'KEYCODE_HOME';
  if (key === 'reload_app') return 'KEYCODE_R';
  return 'KEYCODE_ENTER';
}

function buildAdbInputArgs(input: AndroidAdbInput): string[] {
  if (input.type === 'tap') return ['tap', String(input.x), String(input.y)];
  if (input.type === 'swipe') {
    return [
      'swipe',
      String(input.x1),
      String(input.y1),
      String(input.x2),
      String(input.y2),
      ...(typeof input.durationMs === 'number' ? [String(input.durationMs)] : []),
    ];
  }
  if (input.type === 'text') return ['text', escapeAdbInputText(input.text)];
  return ['keyevent', mapKeyevent(input.key)];
}

async function runAndroidAdbInput(request: RunAdbInputRequest): Promise<void> {
  const args = [
    ...(request.deviceId ? ['-s', request.deviceId] : []),
    'shell',
    'input',
    ...buildAdbInputArgs(request.input),
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

async function runAndroidAdbReverse(request: RunAdbReverseRequest): Promise<void> {
  const args = [
    ...(request.deviceId ? ['-s', request.deviceId] : []),
    'reverse',
    `tcp:${request.devicePort}`,
    `tcp:${request.hostPort}`,
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
      reject(new Error(message || `adb reverse exited with ${code ?? 'unknown status'}`));
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
  const runAdbReverse = options.runAdbReverse ?? runAndroidAdbReverse;

  return {
    registerAndroidPreview(registration: AndroidPreviewRegistration): void {
      const key = keyFor(registration.sessionId, registration.simulatorSessionId);
      const existing = entries.get(key);
      entries.set(key, {
        registration,
        generation: existing?.generation ?? 0,
        lease: existing?.lease ?? null,
        inputTimeline: existing?.inputTimeline ?? [],
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
        inputTimeline: entry.inputTimeline,
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
        inputTimeline: entry.inputTimeline,
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
        if (entry) {
          recordInputTimeline(entries, key, entry, input, nowMs(), false, 'lease_not_found');
        }
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
        await runAdbInput({
          ...(entry.registration.deviceId ? { deviceId: entry.registration.deviceId } : {}),
          input: toDeviceInput(input.input, entry.registration),
        });
      } catch (error) {
        recordInputTimeline(entries, key, entry, input, nowMs(), false, 'adb_input_failed');
        throw error;
      }
      recordInputTimeline(entries, key, entry, input, nowMs(), true);
      return { ok: true as const };
    },

    async reloadApp(input: SimulatorPreviewLeaseScopedOperationInput) {
      const validation = validateLeaseScopedOperation(entries, input, nowMs());
      if (!validation.ok) return validation.result;
      const request = {
        ...(validation.entry.registration.deviceId ? { deviceId: validation.entry.registration.deviceId } : {}),
        input: { type: 'keyevent' as const, key: 'reload_app' as const },
      };
      await runAdbInput(request);
      await runAdbInput(request);
      return { ok: true as const };
    },

    async reconnectDevServices(input: SimulatorPreviewLeaseScopedOperationInput) {
      const validation = validateLeaseScopedOperation(entries, input, nowMs());
      if (!validation.ok) return validation.result;
      const ports = extractLoopbackDevServicePorts(validation.entry.registration.devServices);
      for (const port of ports) {
        await runAdbReverse({
          ...(validation.entry.registration.deviceId ? { deviceId: validation.entry.registration.deviceId } : {}),
          devicePort: port,
          hostPort: port,
        });
      }
      return { ok: true as const, reconnectedPorts: ports };
    },

    listInputTimeline(input: Readonly<{
      sessionId: string;
      simulatorSessionId: string;
    }>): readonly SimulatorPreviewInputTimelineEntry[] {
      return [...(entries.get(keyFor(input.sessionId, input.simulatorSessionId))?.inputTimeline ?? [])];
    },
  };
}

type SimulatorPreviewLeaseScopedOperationInput = Readonly<{
  sessionId: string;
  simulatorSessionId: string;
  leaseId: string;
  generation: number;
  owner: SimulatorPreviewControlOwner;
  holderId?: string;
}>;

function validateLeaseScopedOperation(
  entries: Map<string, RegistryEntry>,
  input: SimulatorPreviewLeaseScopedOperationInput,
  nowMs: number,
): Readonly<
  | { ok: true; entry: RegistryEntry }
  | {
      ok: false;
      result: Readonly<{
        ok: false;
        errorCode: SimulatorPreviewInputErrorCode;
        error: SimulatorPreviewInputErrorCode;
      }>;
    }
> {
  const entry = entries.get(keyFor(input.sessionId, input.simulatorSessionId));
  if (!entry?.lease) {
    return {
      ok: false,
      result: { ok: false, errorCode: 'lease_not_found', error: 'lease_not_found' },
    };
  }
  if (input.generation !== entry.generation) {
    return {
      ok: false,
      result: { ok: false, errorCode: 'stale_generation', error: 'stale_generation' },
    };
  }
  const leaseError = validateLease(entry.lease, input, nowMs);
  if (leaseError) {
    return { ok: false, result: leaseError };
  }
  return { ok: true, entry };
}

function extractLoopbackDevServicePorts(devServices: SimulatorPreviewV1['devServices'] | undefined): readonly number[] {
  const ports = new Set<number>();
  for (const service of [devServices?.metro, devServices?.api, devServices?.hmr]) {
    const rawUrl = service?.url?.trim();
    if (!rawUrl) continue;
    try {
      const parsed = new URL(rawUrl);
      const hostname = parsed.hostname.toLowerCase();
      if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') continue;
      const port = Number(parsed.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
      ports.add(port);
    } catch {
      continue;
    }
  }
  return [...ports].sort((a, b) => a - b);
}

function toDeviceInput(
  input: SimulatorPreviewNormalizedInput,
  registration: AndroidPreviewRegistration,
): SimulatorPreviewDeviceInput {
  if (input.type === 'tap') {
    return {
      type: 'tap',
      x: Math.round(clampNormalized(input.x) * registration.deviceWidth),
      y: Math.round(clampNormalized(input.y) * registration.deviceHeight),
    };
  }
  if (input.type === 'swipe') {
    return {
      type: 'swipe',
      x1: Math.round(clampNormalized(input.x1) * registration.deviceWidth),
      y1: Math.round(clampNormalized(input.y1) * registration.deviceHeight),
      x2: Math.round(clampNormalized(input.x2) * registration.deviceWidth),
      y2: Math.round(clampNormalized(input.y2) * registration.deviceHeight),
      ...(typeof input.durationMs === 'number' ? { durationMs: input.durationMs } : {}),
    };
  }
  return input;
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
  errorCode?: SimulatorPreviewInputErrorCode,
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
