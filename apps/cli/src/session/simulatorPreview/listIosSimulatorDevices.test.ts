import { describe, expect, test } from 'vitest';

import { listIosSimulatorDevices } from './listIosSimulatorDevices';

describe('listIosSimulatorDevices', () => {
  test('parses available iOS simctl devices into discovered simulator devices', async () => {
    const devices = await listIosSimulatorDevices({
      runCommand: async (command, args) => {
        expect(command).toBe('xcrun');
        expect(args).toEqual(['simctl', 'list', 'devices', '--json']);
        return JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [
              { name: 'iPhone 16 Pro', udid: 'ios-1', state: 'Booted', isAvailable: true },
              { name: 'iPhone SE', udid: 'ios-2', state: 'Shutdown', isAvailable: true },
              { name: 'Unavailable iPhone', udid: 'ios-3', state: 'Shutdown', isAvailable: false },
            ],
            'com.apple.CoreSimulator.SimRuntime.tvOS-18-2': [
              { name: 'Apple TV', udid: 'tv-1', state: 'Booted', isAvailable: true },
            ],
          },
        });
      },
    });

    expect(devices).toEqual([
      {
        platform: 'ios',
        deviceId: 'ios-1',
        displayName: 'iPhone 16 Pro',
        state: 'booted',
      },
      {
        platform: 'ios',
        deviceId: 'ios-2',
        displayName: 'iPhone SE',
        state: 'available',
      },
    ]);
  });
});
