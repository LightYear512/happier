import type { SimulatorDeviceService } from '@/session/simulatorPreview/createSimulatorDeviceService';
import type { SimulatorDeviceLeaseRenewalController } from '@/session/simulatorPreview/createSimulatorDeviceLeaseRenewalController';

type SimulatorPreviewPlatform = 'android' | 'ios';
type ClosableSimulatorPreviewStream = Readonly<{
  close: () => Promise<void>;
}>;
type ClosableSimulatorPreviewStreamRegistry = Readonly<{
  values: () => IterableIterator<ClosableSimulatorPreviewStream>;
  clear: () => void;
}>;

export async function closeSimulatorPreviewRuntime(params: Readonly<{
  sessionId: string;
  androidStreams: ClosableSimulatorPreviewStreamRegistry;
  iosStreams: ClosableSimulatorPreviewStreamRegistry;
  simulatorPreviewControlPlatforms: Map<string, SimulatorPreviewPlatform>;
  simulatorPreviewControlRegistry: Readonly<{
    clearSessionPreviews: (input: Readonly<{ sessionId: string }>) => void;
  }>;
  simulatorDeviceService: Pick<SimulatorDeviceService, 'releaseSessionPreviews'>;
  simulatorDeviceLeaseRenewals: Pick<SimulatorDeviceLeaseRenewalController, 'clearSession'>;
}>): Promise<void> {
  params.simulatorDeviceLeaseRenewals.clearSession(params.sessionId);
  params.simulatorDeviceService.releaseSessionPreviews({ sessionId: params.sessionId });
  params.simulatorPreviewControlRegistry.clearSessionPreviews({ sessionId: params.sessionId });
  clearSessionPlatformEntries(params.simulatorPreviewControlPlatforms, params.sessionId);

  await Promise.all([
    closeStreams(params.androidStreams),
    closeStreams(params.iosStreams),
  ]);
}

async function closeStreams(
  streams: ClosableSimulatorPreviewStreamRegistry,
): Promise<void> {
  const active = [...streams.values()];
  streams.clear();
  await Promise.all(active.map(async (stream) => {
    await stream.close();
  }));
}

function clearSessionPlatformEntries(
  platforms: Map<string, SimulatorPreviewPlatform>,
  sessionId: string,
): void {
  const prefix = `${sessionId}\u0000`;
  for (const key of platforms.keys()) {
    if (key.startsWith(prefix)) {
      platforms.delete(key);
    }
  }
}
