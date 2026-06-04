import { describe, expect, it, vi } from 'vitest';

import { closeSimulatorPreviewRuntime } from './simulatorPreviewRuntimeCleanup';

describe('closeSimulatorPreviewRuntime', () => {
  it('closes Android and iOS streams and releases session-owned simulator preview state', async () => {
    const closeAndroid = vi.fn(async () => {});
    const closeIos = vi.fn(async () => {});
    const androidStreams = new Map([
      ['sess_1', {
        host: '127.0.0.1',
        port: 9812,
        frameUrl: 'http://127.0.0.1:9812/frame.jpg',
        streamUrl: 'http://127.0.0.1:9812/stream.mjpeg',
        close: closeAndroid,
      }],
    ]);
    const iosStreams = new Map([
      ['sess_1', {
        host: '127.0.0.1',
        port: 9814,
        frameUrl: 'http://127.0.0.1:9814/frame.jpg',
        streamUrl: 'http://127.0.0.1:9814/stream.mjpeg',
        close: closeIos,
      }],
    ]);
    const simulatorPreviewControlPlatforms = new Map([
      ['sess_1\u0000sim_android_1', 'android' as const],
      ['sess_1\u0000sim_ios_1', 'ios' as const],
      ['sess_other\u0000sim_ios_2', 'ios' as const],
    ]);
    const simulatorDeviceService = {
      releaseSessionPreviews: vi.fn(),
    };
    const simulatorDeviceLeaseRenewals = {
      clearSession: vi.fn(),
    };
    const simulatorPreviewControlRegistry = {
      clearSessionPreviews: vi.fn(),
    };

    await closeSimulatorPreviewRuntime({
      sessionId: 'sess_1',
      androidStreams,
      iosStreams,
      simulatorPreviewControlPlatforms,
      simulatorDeviceService,
      simulatorDeviceLeaseRenewals,
      simulatorPreviewControlRegistry,
    });

    expect(closeAndroid).toHaveBeenCalledTimes(1);
    expect(closeIos).toHaveBeenCalledTimes(1);
    expect(androidStreams.size).toBe(0);
    expect(iosStreams.size).toBe(0);
    expect(simulatorPreviewControlPlatforms.has('sess_1\u0000sim_android_1')).toBe(false);
    expect(simulatorPreviewControlPlatforms.has('sess_1\u0000sim_ios_1')).toBe(false);
    expect(simulatorPreviewControlPlatforms.has('sess_other\u0000sim_ios_2')).toBe(true);
    expect(simulatorDeviceService.releaseSessionPreviews).toHaveBeenCalledWith({ sessionId: 'sess_1' });
    expect(simulatorDeviceLeaseRenewals.clearSession).toHaveBeenCalledWith('sess_1');
    expect(simulatorPreviewControlRegistry.clearSessionPreviews).toHaveBeenCalledWith({ sessionId: 'sess_1' });
  });
});
