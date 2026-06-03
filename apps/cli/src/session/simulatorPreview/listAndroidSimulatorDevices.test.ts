import { describe, expect, test } from 'vitest';

import { listAndroidSimulatorDevices } from './listAndroidSimulatorDevices';

describe('listAndroidSimulatorDevices', () => {
  test('parses adb device rows into discovered simulator devices', async () => {
    const devices = await listAndroidSimulatorDevices({
      runCommand: async (command, args) => {
        if (command === 'emulator') {
          expect(args).toEqual(['-list-avds']);
          return '';
        }
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

  test('includes cold Android AVDs from emulator -list-avds as available devices', async () => {
    const commands: Array<Readonly<{ command: string; args: readonly string[] }>> = [];
    const devices = await listAndroidSimulatorDevices({
      runCommand: async (command, args) => {
        commands.push({ command, args });
        if (command === 'adb' && args[0] === 'devices') {
          return [
            'List of devices attached',
            'emulator-5554 device product:sdk_gphone64_arm64 model:Pixel_8_Pro device:emu64a transport_id:1',
            '',
          ].join('\n');
        }
        if (command === 'adb' && args.join(' ') === '-s emulator-5554 emu avd name') {
          return 'Pixel_8_API_35\nOK\n';
        }
        if (command === 'emulator') {
          return [
            'Pixel_8_API_35',
            'Pixel_Tablet_API_35',
            '',
          ].join('\n');
        }
        throw new Error(`unexpected command: ${command}`);
      },
    });

    expect(commands).toEqual([
      { command: 'adb', args: ['devices', '-l'] },
      { command: 'emulator', args: ['-list-avds'] },
      { command: 'adb', args: ['-s', 'emulator-5554', 'emu', 'avd', 'name'] },
    ]);
    expect(devices).toEqual([
      {
        platform: 'android',
        deviceId: 'emulator-5554',
        displayName: 'Pixel 8 Pro',
        state: 'booted',
      },
      {
        platform: 'android',
        deviceId: 'avd:Pixel_Tablet_API_35',
        displayName: 'Pixel Tablet API 35',
        state: 'available',
      },
    ]);
  });
});
