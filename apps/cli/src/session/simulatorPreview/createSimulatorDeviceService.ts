import { randomUUID } from 'node:crypto';

import { listAndroidSimulatorDevices } from './listAndroidSimulatorDevices';
import { listIosSimulatorDevices } from './listIosSimulatorDevices';
import {
  buildSimulatorDeviceRef,
  type DiscoveredSimulatorDevice,
  type SimulatorDeviceListItem,
  type SimulatorDevicePlatform,
} from './simulatorDeviceTypes';

export type SimulatorDeviceService = ReturnType<typeof createSimulatorDeviceService>;

type PreviewOwner = 'ai' | 'user';

type DeviceWriter = Readonly<{
  sessionId: string;
  simulatorSessionId: string;
  owner: PreviewOwner;
  leaseId: string;
  expiresAtMs: number;
}>;

type PreviewReservation = Readonly<{
  sessionId: string;
  simulatorSessionId: string;
  deviceRef: string;
  deviceId: string;
  platform: SimulatorDevicePlatform;
  controlCapability: 'writable' | 'readonly';
  controlUnavailableReason?: 'device_in_use' | 'device_selection_required' | 'device_unavailable';
}>;

type WritableReservationResult = Readonly<{
  ok: true;
  controlCapability: 'writable';
  deviceRef: string;
  deviceId: string;
  deviceDisplayName: string;
  writerLeaseId: string;
}>;

type ReadonlyReservationResult = Readonly<{
  ok: true;
  controlCapability: 'readonly';
  controlUnavailableReason: 'device_in_use';
  deviceRef: string;
  deviceId: string;
  deviceDisplayName: string;
}>;

type ReservationResult =
  | WritableReservationResult
  | ReadonlyReservationResult
  | Readonly<{
      ok: false;
      code: 'device_not_found' | 'device_selection_required';
      devices?: readonly SimulatorDeviceListItem[];
    }>;

export type SimulatorDeviceServiceOptions = Readonly<{
  nowMs?: () => number;
  randomId?: () => string;
  writerLeaseTtlMs?: number;
  discoverAndroidDevices?: () => Promise<readonly DiscoveredSimulatorDevice[]>;
  discoverIosDevices?: () => Promise<readonly DiscoveredSimulatorDevice[]>;
}>;

const DEFAULT_WRITER_LEASE_TTL_MS = 60_000;

function deviceKey(platform: SimulatorDevicePlatform, deviceId: string): string {
  return buildSimulatorDeviceRef(platform, deviceId);
}

function previewKey(sessionId: string, simulatorSessionId: string): string {
  return `${sessionId}\u0000${simulatorSessionId}`;
}

function isDeviceWritableState(device: DiscoveredSimulatorDevice): boolean {
  return device.state === 'booted' || device.state === 'available';
}

function sortDevices(devices: readonly DiscoveredSimulatorDevice[]): readonly DiscoveredSimulatorDevice[] {
  return [...devices].sort((a, b) => {
    const platformOrder = a.platform.localeCompare(b.platform);
    if (platformOrder !== 0) return platformOrder;
    const stateOrder = a.state === 'booted' && b.state !== 'booted' ? -1 : a.state !== 'booted' && b.state === 'booted' ? 1 : 0;
    if (stateOrder !== 0) return stateOrder;
    return a.displayName.localeCompare(b.displayName);
  });
}

function resolveAutoSelectionCandidate(
  candidates: readonly DiscoveredSimulatorDevice[],
): DiscoveredSimulatorDevice | null {
  if (candidates.length === 1) return candidates[0] ?? null;
  const bootedCandidates = candidates.filter((device) => device.state === 'booted');
  if (bootedCandidates.length === 1) return bootedCandidates[0] ?? null;
  return null;
}

export function createSimulatorDeviceService(
  options: SimulatorDeviceServiceOptions = {},
) {
  const nowMs = options.nowMs ?? (() => Date.now());
  const randomId = options.randomId ?? (() => randomUUID());
  const writerLeaseTtlMs = options.writerLeaseTtlMs ?? DEFAULT_WRITER_LEASE_TTL_MS;
  const discoverAndroidDevices = options.discoverAndroidDevices ?? listAndroidSimulatorDevices;
  const discoverIosDevices = options.discoverIosDevices ?? listIosSimulatorDevices;
  const writers = new Map<string, DeviceWriter>();
  const previews = new Map<string, PreviewReservation>();

  function pruneExpiredWriters(): void {
    const now = nowMs();
    for (const [key, writer] of writers.entries()) {
      if (now > writer.expiresAtMs) {
        writers.delete(key);
      }
    }
  }

  async function discoverPlatformDevices(
    discover: () => Promise<readonly DiscoveredSimulatorDevice[]>,
  ): Promise<readonly DiscoveredSimulatorDevice[]> {
    try {
      return await discover();
    } catch {
      return [];
    }
  }

  async function discoverDevices(platform?: SimulatorDevicePlatform): Promise<readonly DiscoveredSimulatorDevice[]> {
    const [androidDevices, iosDevices] = await Promise.all([
      platform === 'ios' ? Promise.resolve([]) : discoverPlatformDevices(discoverAndroidDevices),
      platform === 'android' ? Promise.resolve([]) : discoverPlatformDevices(discoverIosDevices),
    ]);
    return sortDevices([...androidDevices, ...iosDevices]);
  }

  function toListItem(device: DiscoveredSimulatorDevice, recommended: boolean): SimulatorDeviceListItem {
    const key = deviceKey(device.platform, device.deviceId);
    const writer = writers.get(key);
    const writableState = isDeviceWritableState(device);
    return {
      deviceRef: key,
      platform: device.platform,
      displayName: device.displayName,
      state: device.state,
      availability: !writableState ? 'unavailable' : writer ? 'busy' : 'writable',
      recommended,
    };
  }

  async function listDevices(input: Readonly<{ platform?: SimulatorDevicePlatform }>): Promise<Readonly<{
    devices: readonly SimulatorDeviceListItem[];
  }>> {
    pruneExpiredWriters();
    const devices = await discoverDevices(input.platform);
    let recommendedAssigned = false;
    return {
      devices: devices.map((device) => {
        const canRecommend = !recommendedAssigned && isDeviceWritableState(device) && !writers.has(deviceKey(device.platform, device.deviceId));
        if (canRecommend) recommendedAssigned = true;
        return toListItem(device, canRecommend);
      }),
    };
  }

  function releasePreview(input: Readonly<{
    sessionId: string;
    simulatorSessionId: string;
  }>): void {
    const key = previewKey(input.sessionId, input.simulatorSessionId);
    const reservation = previews.get(key);
    previews.delete(key);
    if (reservation?.controlCapability === 'writable') {
      const writer = writers.get(reservation.deviceRef);
      if (writer?.sessionId === input.sessionId && writer.simulatorSessionId === input.simulatorSessionId) {
        writers.delete(reservation.deviceRef);
      }
    }
  }

  return {
    listDevices,

    async reservePreview(input: Readonly<{
      sessionId: string;
      simulatorSessionId: string;
      platform: SimulatorDevicePlatform;
      selection?: 'auto';
      deviceRef?: string;
      deviceId?: string;
      owner: PreviewOwner;
    }>): Promise<ReservationResult> {
      pruneExpiredWriters();
      const devices = await discoverDevices(input.platform);
      const requestedRef = input.deviceRef
        ?? (input.deviceId ? deviceKey(input.platform, input.deviceId) : '');
      const target = requestedRef
        ? devices.find((device) => deviceKey(device.platform, device.deviceId) === requestedRef)
        : null;
      const candidates = target ? [target] : devices.filter(isDeviceWritableState);
      if (candidates.length === 0) {
        return { ok: false, code: 'device_not_found' };
      }
      const autoSelectedDevice = target ?? resolveAutoSelectionCandidate(candidates);
      if (!autoSelectedDevice) {
        return {
          ok: false,
          code: 'device_selection_required',
          devices: (await listDevices({ platform: input.platform })).devices,
        };
      }
      const device = autoSelectedDevice;
      if (!device || !isDeviceWritableState(device)) {
        return { ok: false, code: 'device_not_found' };
      }
      const key = deviceKey(device.platform, device.deviceId);
      const existingWriter = writers.get(key);
      const keyForPreview = previewKey(input.sessionId, input.simulatorSessionId);
      if (existingWriter && existingWriter.sessionId !== input.sessionId) {
        previews.set(keyForPreview, {
          sessionId: input.sessionId,
          simulatorSessionId: input.simulatorSessionId,
          deviceRef: key,
          deviceId: device.deviceId,
          platform: device.platform,
          controlCapability: 'readonly',
          controlUnavailableReason: 'device_in_use',
        });
        return {
          ok: true,
          controlCapability: 'readonly',
          controlUnavailableReason: 'device_in_use',
          deviceRef: key,
          deviceId: device.deviceId,
          deviceDisplayName: device.displayName,
        };
      }
      const writer: DeviceWriter = {
        sessionId: input.sessionId,
        simulatorSessionId: input.simulatorSessionId,
        owner: input.owner,
        leaseId: existingWriter?.leaseId ?? randomId(),
        expiresAtMs: nowMs() + writerLeaseTtlMs,
      };
      writers.set(key, writer);
      previews.set(keyForPreview, {
        sessionId: input.sessionId,
        simulatorSessionId: input.simulatorSessionId,
        deviceRef: key,
        deviceId: device.deviceId,
        platform: device.platform,
        controlCapability: 'writable',
      });
      return {
        ok: true,
        controlCapability: 'writable',
        deviceRef: key,
        deviceId: device.deviceId,
        deviceDisplayName: device.displayName,
        writerLeaseId: writer.leaseId,
      };
    },

    assertPreviewWritable(input: Readonly<{
      sessionId: string;
      simulatorSessionId: string;
    }>) {
      pruneExpiredWriters();
      const reservation = previews.get(previewKey(input.sessionId, input.simulatorSessionId));
      if (!reservation) {
        return { ok: false as const, errorCode: 'simulator_preview_not_found' as const, error: 'simulator_preview_not_found' as const };
      }
      if (reservation.controlCapability !== 'writable') {
        return { ok: false as const, errorCode: 'device_readonly' as const, error: 'device_readonly' as const };
      }
      const writer = writers.get(reservation.deviceRef);
      if (!writer || writer.sessionId !== input.sessionId || writer.simulatorSessionId !== input.simulatorSessionId) {
        return { ok: false as const, errorCode: 'device_in_use' as const, error: 'device_in_use' as const };
      }
      return { ok: true as const };
    },

    releasePreview,

    releaseSessionPreviews(input: Readonly<{
      sessionId: string;
      platform?: SimulatorDevicePlatform;
      excludeSimulatorSessionId?: string;
    }>): void {
      for (const reservation of [...previews.values()]) {
        if (reservation.sessionId !== input.sessionId) continue;
        if (input.platform && reservation.platform !== input.platform) continue;
        if (input.excludeSimulatorSessionId && reservation.simulatorSessionId === input.excludeSimulatorSessionId) continue;
        releasePreview({
          sessionId: reservation.sessionId,
          simulatorSessionId: reservation.simulatorSessionId,
        });
      }
    },
  };
}
