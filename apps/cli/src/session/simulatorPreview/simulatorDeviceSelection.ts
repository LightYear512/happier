import type { DiscoveredSimulatorDevice } from './simulatorDeviceTypes';

export function isDeviceWritableState(device: DiscoveredSimulatorDevice): boolean {
  return device.state === 'booted' || device.state === 'available';
}

export function sortDiscoveredSimulatorDevices(
  devices: readonly DiscoveredSimulatorDevice[],
): readonly DiscoveredSimulatorDevice[] {
  return [...devices].sort((a, b) => {
    const platformOrder = a.platform.localeCompare(b.platform);
    if (platformOrder !== 0) return platformOrder;
    const stateOrder = a.state === 'booted' && b.state !== 'booted' ? -1 : a.state !== 'booted' && b.state === 'booted' ? 1 : 0;
    if (stateOrder !== 0) return stateOrder;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function resolveAutoSelectionCandidate(
  candidates: readonly DiscoveredSimulatorDevice[],
): DiscoveredSimulatorDevice | null {
  if (candidates.length === 1) return candidates[0] ?? null;
  const bootedCandidates = candidates.filter((device) => device.state === 'booted');
  if (bootedCandidates.length === 1) return bootedCandidates[0] ?? null;
  return null;
}
