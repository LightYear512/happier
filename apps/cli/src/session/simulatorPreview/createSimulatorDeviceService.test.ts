import { describe, expect, it } from 'vitest';

import { createSimulatorDeviceService } from './createSimulatorDeviceService';

describe('createSimulatorDeviceService', () => {
  it('lists normalized simulator devices without requiring callers to parse adb or simctl output', async () => {
    const service = createSimulatorDeviceService({
      discoverAndroidDevices: async () => [
        {
          platform: 'android',
          deviceId: 'emulator-5554',
          displayName: 'Pixel 8 API 35',
          state: 'booted',
        },
      ],
      discoverIosDevices: async () => [
        {
          platform: 'ios',
          deviceId: 'A1B2-C3D4',
          displayName: 'iPhone 15 Pro',
          state: 'available',
        },
      ],
    });

    await expect(service.listDevices({})).resolves.toEqual({
      devices: [
        {
          deviceRef: 'android:emulator-5554',
          platform: 'android',
          displayName: 'Pixel 8 API 35',
          state: 'booted',
          availability: 'writable',
          recommended: true,
        },
        {
          deviceRef: 'ios:A1B2-C3D4',
          platform: 'ios',
          displayName: 'iPhone 15 Pro',
          state: 'available',
          availability: 'writable',
          recommended: false,
        },
      ],
    });
  });

  it('reserves one writer per physical simulator device and makes later sessions readonly', async () => {
    let now = 1_000;
    const service = createSimulatorDeviceService({
      nowMs: () => now,
      randomId: () => 'device_lease_1',
      discoverAndroidDevices: async () => [
        {
          platform: 'android',
          deviceId: 'emulator-5554',
          displayName: 'Pixel 8 API 35',
          state: 'booted',
        },
      ],
      discoverIosDevices: async () => [],
    });

    const first = await service.reservePreview({
      sessionId: 'session_a',
      simulatorSessionId: 'sim_a',
      platform: 'android',
      selection: 'auto',
      owner: 'ai',
    });
    expect(first).toEqual(expect.objectContaining({
      ok: true,
      controlCapability: 'writable',
      deviceRef: 'android:emulator-5554',
      deviceId: 'emulator-5554',
      deviceDisplayName: 'Pixel 8 API 35',
    }));

    const second = await service.reservePreview({
      sessionId: 'session_b',
      simulatorSessionId: 'sim_b',
      platform: 'android',
      selection: 'auto',
      owner: 'ai',
    });
    expect(second).toEqual(expect.objectContaining({
      ok: true,
      controlCapability: 'readonly',
      controlUnavailableReason: 'device_in_use',
      deviceRef: 'android:emulator-5554',
    }));
    expect(service.assertPreviewWritable({
      sessionId: 'session_b',
      simulatorSessionId: 'sim_b',
    })).toEqual({
      ok: false,
      errorCode: 'device_readonly',
      error: 'device_readonly',
    });

    now = 61_001;
    expect(service.assertPreviewWritable({
      sessionId: 'session_b',
      simulatorSessionId: 'sim_b',
    })).toEqual({
      ok: false,
      errorCode: 'device_readonly',
      error: 'device_readonly',
    });
    const third = await service.reservePreview({
      sessionId: 'session_c',
      simulatorSessionId: 'sim_c',
      platform: 'android',
      selection: 'auto',
      owner: 'ai',
    });
    expect(third).toEqual(expect.objectContaining({
      ok: true,
      controlCapability: 'writable',
    }));
  });

  it('requires explicit selection when multiple writable devices match auto selection', async () => {
    const service = createSimulatorDeviceService({
      discoverAndroidDevices: async () => [
        { platform: 'android', deviceId: 'emulator-5554', displayName: 'Pixel 8', state: 'booted' },
        { platform: 'android', deviceId: 'emulator-5556', displayName: 'Pixel 9', state: 'booted' },
      ],
      discoverIosDevices: async () => [],
    });

    await expect(service.reservePreview({
      sessionId: 'session_a',
      simulatorSessionId: 'sim_a',
      platform: 'android',
      selection: 'auto',
      owner: 'ai',
    })).resolves.toEqual({
      ok: false,
      code: 'device_selection_required',
      devices: [
        expect.objectContaining({ deviceRef: 'android:emulator-5554', displayName: 'Pixel 8' }),
        expect.objectContaining({ deviceRef: 'android:emulator-5556', displayName: 'Pixel 9' }),
      ],
    });
  });

  it('auto-selects the single booted writable device when other writable devices are only available', async () => {
    const service = createSimulatorDeviceService({
      discoverAndroidDevices: async () => [],
      discoverIosDevices: async () => [
        { platform: 'ios', deviceId: 'booted-ios', displayName: 'iPhone 17 Pro', state: 'booted' },
        { platform: 'ios', deviceId: 'available-ipad', displayName: 'iPad (A16)', state: 'available' },
        { platform: 'ios', deviceId: 'available-iphone', displayName: 'iPhone Air', state: 'available' },
      ],
    });

    await expect(service.reservePreview({
      sessionId: 'session_a',
      simulatorSessionId: 'sim_a',
      platform: 'ios',
      selection: 'auto',
      owner: 'ai',
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      controlCapability: 'writable',
      deviceRef: 'ios:booted-ios',
      deviceDisplayName: 'iPhone 17 Pro',
    }));
  });

  it('still lists devices from one platform when the other platform discovery fails', async () => {
    const service = createSimulatorDeviceService({
      discoverAndroidDevices: async () => {
        throw new Error('adb not found');
      },
      discoverIosDevices: async () => [
        { platform: 'ios', deviceId: 'booted-ios', displayName: 'iPhone 17 Pro', state: 'booted' },
      ],
    });

    await expect(service.listDevices({})).resolves.toEqual({
      devices: [
        expect.objectContaining({
          deviceRef: 'ios:booted-ios',
          displayName: 'iPhone 17 Pro',
          availability: 'writable',
          recommended: true,
        }),
      ],
    });
  });
});
