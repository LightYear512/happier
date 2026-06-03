import type { SimulatorDevicePlatform } from './simulatorDeviceTypes';

export type PreviewOwner = 'ai' | 'user';

export type DeviceWriter = Readonly<{
  sessionId: string;
  simulatorSessionId: string;
  owner: PreviewOwner;
  leaseId: string;
  expiresAtMs: number;
}>;

export type PreviewReservation = Readonly<{
  sessionId: string;
  simulatorSessionId: string;
  deviceRef: string;
  deviceId: string;
  platform: SimulatorDevicePlatform;
  controlCapability: 'writable' | 'readonly';
  controlUnavailableReason?: 'device_in_use' | 'device_selection_required' | 'device_unavailable' | 'capacity_exhausted';
}>;

export type SimulatorDeviceLockStore = Readonly<{
  withLock: <T>(fn: () => T) => T;
  getWriter: (deviceRef: string) => DeviceWriter | undefined;
  setWriter: (deviceRef: string, writer: DeviceWriter) => void;
  deleteWriter: (deviceRef: string) => void;
  listWriters: () => readonly Readonly<{ deviceRef: string; writer: DeviceWriter }>[];
  getPreview: (previewRef: string) => PreviewReservation | undefined;
  setPreview: (previewRef: string, reservation: PreviewReservation) => void;
  deletePreview: (previewRef: string) => void;
  listPreviews: () => readonly PreviewReservation[];
}>;
