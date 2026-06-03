import { randomUUID } from 'node:crypto';

export { createFileSimulatorDeviceLockStore } from './createFileSimulatorDeviceLockStore';
import { listAndroidSimulatorDevices } from './listAndroidSimulatorDevices';
import { listIosSimulatorDevices } from './listIosSimulatorDevices';
import {
  buildSimulatorDeviceRef,
  type DiscoveredSimulatorDevice,
  type SimulatorDeviceListItem,
  type SimulatorDevicePlatform,
} from './simulatorDeviceTypes';
import {
  isDeviceWritableState,
  resolveAutoSelectionCandidate,
  sortDiscoveredSimulatorDevices,
} from './simulatorDeviceSelection';
import type {
  DeviceWriter,
  PreviewOwner,
  PreviewReservation,
  SimulatorDeviceLockStore,
} from './simulatorDeviceLockStoreTypes';

export type SimulatorDeviceService = ReturnType<typeof createSimulatorDeviceService>;
export type {
  DeviceWriter,
  PreviewOwner,
  PreviewReservation,
  SimulatorDeviceLockStore,
} from './simulatorDeviceLockStoreTypes';

export type SimulatorDeviceCapacityPolicy = Readonly<{
  maxWritableSimulatorSessions?: number;
}>;

type WritableReservationResult = Readonly<{
  ok: true;
  controlCapability: 'writable';
  deviceRef: string;
  deviceId: string;
  deviceState: DiscoveredSimulatorDevice['state'];
  deviceDisplayName: string;
  writerLeaseId: string;
}>;

type ReadonlyReservationResult = Readonly<{
  ok: true;
  controlCapability: 'readonly';
  controlUnavailableReason: 'device_in_use';
  deviceRef: string;
  deviceId: string;
  deviceState: DiscoveredSimulatorDevice['state'];
  deviceDisplayName: string;
}>;

type ReservationResult =
  | WritableReservationResult
  | ReadonlyReservationResult
  | Readonly<{
      ok: false;
      code: 'device_not_found' | 'device_selection_required' | 'capacity_exhausted';
      devices?: readonly SimulatorDeviceListItem[];
    }>;

export type SimulatorDeviceServiceOptions = Readonly<{
  nowMs?: () => number;
  randomId?: () => string;
  writerLeaseTtlMs?: number;
  lockStore?: SimulatorDeviceLockStore;
  capacityPolicy?: SimulatorDeviceCapacityPolicy;
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

export function createInMemorySimulatorDeviceLockStore(): SimulatorDeviceLockStore {
  const writers = new Map<string, DeviceWriter>();
  const previews = new Map<string, PreviewReservation>();
  return {
    withLock: (fn) => fn(),
    getWriter: (deviceRef) => writers.get(deviceRef),
    setWriter: (deviceRef, writer) => {
      writers.set(deviceRef, writer);
    },
    deleteWriter: (deviceRef) => {
      writers.delete(deviceRef);
    },
    listWriters: () => [...writers.entries()].map(([deviceRef, writer]) => ({ deviceRef, writer })),
    getPreview: (previewRef) => previews.get(previewRef),
    setPreview: (previewRef, reservation) => {
      previews.set(previewRef, reservation);
    },
    deletePreview: (previewRef) => {
      previews.delete(previewRef);
    },
    listPreviews: () => [...previews.values()],
  };
}

export function createSimulatorDeviceService(
  options: SimulatorDeviceServiceOptions = {},
) {
  const nowMs = options.nowMs ?? (() => Date.now());
  const randomId = options.randomId ?? (() => randomUUID());
  const writerLeaseTtlMs = options.writerLeaseTtlMs ?? DEFAULT_WRITER_LEASE_TTL_MS;
  const capacityPolicy = options.capacityPolicy ?? {};
  const discoverAndroidDevices = options.discoverAndroidDevices ?? listAndroidSimulatorDevices;
  const discoverIosDevices = options.discoverIosDevices ?? listIosSimulatorDevices;
  const lockStore = options.lockStore ?? createInMemorySimulatorDeviceLockStore();

  function pruneExpiredWriters(): void {
    const now = nowMs();
    for (const { deviceRef, writer } of lockStore.listWriters()) {
      if (now > writer.expiresAtMs) {
        lockStore.deleteWriter(deviceRef);
      }
    }
  }

  function countWritableSimulatorSessions(): number {
    return lockStore.listWriters().length;
  }

  function isWritableCapacityFull(): boolean {
    const maxWritableSimulatorSessions = capacityPolicy.maxWritableSimulatorSessions;
    return typeof maxWritableSimulatorSessions === 'number'
      && maxWritableSimulatorSessions >= 0
      && countWritableSimulatorSessions() >= maxWritableSimulatorSessions;
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
    return sortDiscoveredSimulatorDevices([...androidDevices, ...iosDevices]);
  }

  function toListItem(device: DiscoveredSimulatorDevice, recommended: boolean, writableCapacityFull: boolean): SimulatorDeviceListItem {
    const key = deviceKey(device.platform, device.deviceId);
    const writer = lockStore.getWriter(key);
    const writableState = isDeviceWritableState(device);
    return {
      deviceRef: key,
      platform: device.platform,
      displayName: device.displayName,
      state: device.state,
      availability: !writableState ? 'unavailable' : writer ? 'busy' : writableCapacityFull ? 'capacity_exhausted' : 'writable',
      recommended,
    };
  }

  async function listDevices(input: Readonly<{ platform?: SimulatorDevicePlatform }>): Promise<Readonly<{
    devices: readonly SimulatorDeviceListItem[];
  }>> {
    const devices = await discoverDevices(input.platform);
    return lockStore.withLock(() => {
      pruneExpiredWriters();
      const writableCapacityFull = isWritableCapacityFull();
      let recommendedAssigned = false;
      return {
        devices: devices.map((device) => {
          const canRecommend = !recommendedAssigned
            && isDeviceWritableState(device)
            && !writableCapacityFull
            && !lockStore.getWriter(deviceKey(device.platform, device.deviceId));
          if (canRecommend) recommendedAssigned = true;
          return toListItem(device, canRecommend, writableCapacityFull);
        }),
      };
    });
  }

  function releasePreview(input: Readonly<{
    sessionId: string;
    simulatorSessionId: string;
  }>): void {
    lockStore.withLock(() => {
      pruneExpiredWriters();
      const key = previewKey(input.sessionId, input.simulatorSessionId);
      const reservation = lockStore.getPreview(key);
      lockStore.deletePreview(key);
      if (reservation?.controlCapability === 'writable') {
        const writer = lockStore.getWriter(reservation.deviceRef);
        if (writer?.sessionId === input.sessionId && writer.simulatorSessionId === input.simulatorSessionId) {
          lockStore.deleteWriter(reservation.deviceRef);
        }
      }
    });
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
      return lockStore.withLock<ReservationResult>(() => {
        pruneExpiredWriters();
        const key = deviceKey(device.platform, device.deviceId);
        const existingWriter = lockStore.getWriter(key);
        const keyForPreview = previewKey(input.sessionId, input.simulatorSessionId);
        if (existingWriter && existingWriter.sessionId !== input.sessionId) {
          lockStore.setPreview(keyForPreview, {
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
            deviceState: device.state,
            deviceDisplayName: device.displayName,
          };
        }
        if (!existingWriter && isWritableCapacityFull()) {
          return {
            ok: false,
            code: 'capacity_exhausted',
          };
        }
        const writer: DeviceWriter = {
          sessionId: input.sessionId,
          simulatorSessionId: input.simulatorSessionId,
          owner: input.owner,
          leaseId: existingWriter?.leaseId ?? randomId(),
          expiresAtMs: nowMs() + writerLeaseTtlMs,
        };
        lockStore.setWriter(key, writer);
        lockStore.setPreview(keyForPreview, {
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
          deviceState: device.state,
          deviceDisplayName: device.displayName,
          writerLeaseId: writer.leaseId,
        };
      });
    },

    assertPreviewWritable(input: Readonly<{
      sessionId: string;
      simulatorSessionId: string;
    }>) {
      return lockStore.withLock(() => {
        pruneExpiredWriters();
        const reservation = lockStore.getPreview(previewKey(input.sessionId, input.simulatorSessionId));
        if (!reservation) {
          return { ok: false as const, errorCode: 'simulator_preview_not_found' as const, error: 'simulator_preview_not_found' as const };
        }
        if (reservation.controlCapability !== 'writable') {
          return { ok: false as const, errorCode: 'device_readonly' as const, error: 'device_readonly' as const };
        }
        const writer = lockStore.getWriter(reservation.deviceRef);
        if (!writer || writer.sessionId !== input.sessionId || writer.simulatorSessionId !== input.simulatorSessionId) {
          return { ok: false as const, errorCode: 'device_in_use' as const, error: 'device_in_use' as const };
        }
        return { ok: true as const };
      });
    },

    renewPreviewWriter(input: Readonly<{
      sessionId: string;
      simulatorSessionId: string;
    }>) {
      return lockStore.withLock(() => {
        pruneExpiredWriters();
        const reservation = lockStore.getPreview(previewKey(input.sessionId, input.simulatorSessionId));
        if (!reservation) {
          return { ok: false as const, errorCode: 'simulator_preview_not_found' as const, error: 'simulator_preview_not_found' as const };
        }
        if (reservation.controlCapability !== 'writable') {
          return { ok: false as const, errorCode: 'device_readonly' as const, error: 'device_readonly' as const };
        }
        const writer = lockStore.getWriter(reservation.deviceRef);
        if (!writer || writer.sessionId !== input.sessionId || writer.simulatorSessionId !== input.simulatorSessionId) {
          return { ok: false as const, errorCode: 'device_in_use' as const, error: 'device_in_use' as const };
        }
        lockStore.setWriter(reservation.deviceRef, {
          ...writer,
          expiresAtMs: nowMs() + writerLeaseTtlMs,
        });
        return { ok: true as const };
      });
    },

    releasePreview,

    releaseSessionPreviews(input: Readonly<{
      sessionId: string;
      platform?: SimulatorDevicePlatform;
      excludeSimulatorSessionId?: string;
    }>): void {
      lockStore.withLock(() => {
        pruneExpiredWriters();
        for (const reservation of lockStore.listPreviews()) {
          if (reservation.sessionId !== input.sessionId) continue;
          if (input.platform && reservation.platform !== input.platform) continue;
          if (input.excludeSimulatorSessionId && reservation.simulatorSessionId === input.excludeSimulatorSessionId) continue;
          const key = previewKey(reservation.sessionId, reservation.simulatorSessionId);
          lockStore.deletePreview(key);
          if (reservation.controlCapability !== 'writable') continue;
          const writer = lockStore.getWriter(reservation.deviceRef);
          if (writer?.sessionId === reservation.sessionId && writer.simulatorSessionId === reservation.simulatorSessionId) {
            lockStore.deleteWriter(reservation.deviceRef);
          }
        }
      });
    },
  };
}
