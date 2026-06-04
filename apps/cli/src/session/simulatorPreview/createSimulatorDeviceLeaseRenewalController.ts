import type { SimulatorDeviceService } from './createSimulatorDeviceService';
import type { SimulatorDevicePlatform } from './simulatorDeviceTypes';

type LeaseRenewalFailure = Readonly<{
  sessionId: string;
  simulatorSessionId: string;
  platform: SimulatorDevicePlatform;
  result?: ReturnType<SimulatorDeviceService['renewPreviewWriter']>;
  error?: unknown;
}>;

export type SimulatorDeviceLeaseRenewalController = Readonly<{
  start: (input: Readonly<{
    sessionId: string;
    simulatorSessionId: string;
    platform: SimulatorDevicePlatform;
    writable: boolean;
  }>) => void;
  clear: (sessionId: string, platform: SimulatorDevicePlatform) => void;
  clearSession: (sessionId: string) => void;
}>;

export function createSimulatorDeviceLeaseRenewalController(input: Readonly<{
  simulatorDeviceService: SimulatorDeviceService;
  renewIntervalMs: number;
  onRenewalFailed?: (failure: LeaseRenewalFailure) => void;
}>): SimulatorDeviceLeaseRenewalController {
  const activeRenewals = new Map<string, NodeJS.Timeout>();

  function renewalKey(sessionId: string, platform: SimulatorDevicePlatform): string {
    return `${sessionId}\u0000${platform}`;
  }

  function clear(sessionId: string, platform: SimulatorDevicePlatform): void {
    const key = renewalKey(sessionId, platform);
    const timer = activeRenewals.get(key);
    if (!timer) return;
    activeRenewals.delete(key);
    clearInterval(timer);
  }

  function clearSession(sessionId: string): void {
    clear(sessionId, 'android');
    clear(sessionId, 'ios');
  }

  function start(startInput: Readonly<{
    sessionId: string;
    simulatorSessionId: string;
    platform: SimulatorDevicePlatform;
    writable: boolean;
  }>): void {
    clear(startInput.sessionId, startInput.platform);
    if (!startInput.writable || typeof input.simulatorDeviceService.renewPreviewWriter !== 'function') return;
    const timer = setInterval(() => {
      try {
        const result = input.simulatorDeviceService.renewPreviewWriter({
          sessionId: startInput.sessionId,
          simulatorSessionId: startInput.simulatorSessionId,
        });
        if (!result.ok) {
          clear(startInput.sessionId, startInput.platform);
          input.onRenewalFailed?.({ ...startInput, result });
        }
      } catch (error) {
        input.onRenewalFailed?.({ ...startInput, error });
      }
    }, input.renewIntervalMs);
    timer.unref?.();
    activeRenewals.set(renewalKey(startInput.sessionId, startInput.platform), timer);
  }

  return { start, clear, clearSession };
}
