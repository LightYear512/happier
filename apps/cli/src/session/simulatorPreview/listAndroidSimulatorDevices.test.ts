import { describe, expect, test } from 'vitest';

import { listAndroidSimulatorDevices } from './listAndroidSimulatorDevices';

describe('listAndroidSimulatorDevices', () => {
  test('parses adb device rows into discovered simulator devices', async () => {
    const devices = await listAndroidSimulatorDevices({
      runCommand: async (command, args) => {
        expect(command).toBe('adb');
        expect(args).toEqual(['devices', '-l']);
        return [
          'List of devices attached',
          'emulator-5554 device product:sdk_gphone64_arm64 model:Pixel_8_Pro device:emu64a transport_id:1',
          'emulator-5556 offline transport_id:2',
          '',
        ].join('\n');
      },
    });

    expect(devices).toEqual([
      {
        platform: 'android',
        deviceId: 'emulator-5554',
        displayName: 'Pixel 8 Pro',
        state: 'booted',
      },
      {
        platform: 'android',
        deviceId: 'emulator-5556',
        displayName: 'emulator-5556',
        state: 'offline',
      },
    ]);
  });
});
