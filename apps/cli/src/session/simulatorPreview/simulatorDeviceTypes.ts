export type SimulatorDevicePlatform = 'android' | 'ios';

export type SimulatorDeviceState = 'booted' | 'available' | 'offline' | 'unknown';

export type SimulatorDeviceAvailability = 'writable' | 'readonly' | 'busy' | 'unavailable' | 'capacity_exhausted';

export type DiscoveredSimulatorDevice = Readonly<{
  platform: SimulatorDevicePlatform;
  deviceId: string;
  displayName: string;
  state: SimulatorDeviceState;
}>;

export type SimulatorDeviceListItem = Readonly<{
  deviceRef: string;
  platform: SimulatorDevicePlatform;
  displayName: string;
  state: SimulatorDeviceState;
  availability: SimulatorDeviceAvailability;
  recommended: boolean;
}>;

export function buildSimulatorDeviceRef(platform: SimulatorDevicePlatform, deviceId: string): string {
  return `${platform}:${deviceId}`;
}

export function parseSimulatorDeviceRef(deviceRef: string): Readonly<{
  platform: SimulatorDevicePlatform;
  deviceId: string;
}> | null {
  const separatorIndex = deviceRef.indexOf(':');
  if (separatorIndex <= 0) return null;
  const platform = deviceRef.slice(0, separatorIndex);
  const deviceId = deviceRef.slice(separatorIndex + 1).trim();
  if ((platform !== 'android' && platform !== 'ios') || !deviceId) return null;
  return { platform, deviceId };
}
