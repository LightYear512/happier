import { describe, expect, it, vi } from 'vitest';

import { ensureAndroidSimulatorPreviewDeviceBooted } from './ensureAndroidSimulatorPreviewDeviceBooted';

describe('ensureAndroidSimulatorPreviewDeviceBooted', () => {
  it('starts a cold Android AVD in relay-only mode and returns the new adb serial', async () => {
    const spawnProcess = vi.fn();
    const runCommand = vi.fn()
      .mockResolvedValueOnce([
        'List of devices attached',
        'emulator-5554 device product:sdk_gphone64_arm64 model:Pixel_8 device:emu64a transport_id:1',
        '',
      ].join('\n'))
      .mockResolvedValueOnce('Pixel_8_API_35\nOK\n')
      .mockResolvedValueOnce([
        'List of devices attached',
        'emulator-5554 device product:sdk_gphone64_arm64 model:Pixel_8 device:emu64a transport_id:1',
        'emulator-5556 device product:sdk_gphone64_arm64 model:Pixel_9 device:emu64a transport_id:2',
        '',
      ].join('\n'))
      .mockResolvedValueOnce('Pixel_8_API_35\nOK\n')
      .mockResolvedValueOnce('Pixel_9_API_35\nOK\n')
      .mockResolvedValueOnce('1\n');

    await expect(ensureAndroidSimulatorPreviewDeviceBooted({
      deviceId: 'avd:Pixel_9_API_35',
      runCommand,
      spawnProcess,
      sleepMs: async () => {},
    })).resolves.toEqual({
      deviceId: 'emulator-5556',
    });

    expect(spawnProcess).toHaveBeenCalledWith('emulator', [
      '@Pixel_9_API_35',
      '-no-window',
      '-no-audio',
      '-no-boot-anim',
    ]);
    expect(runCommand).toHaveBeenNthCalledWith(6, 'adb', ['-s', 'emulator-5556', 'shell', 'getprop', 'sys.boot_completed']);
  });

  it('returns booted adb serials unchanged', async () => {
    await expect(ensureAndroidSimulatorPreviewDeviceBooted({
      deviceId: 'emulator-5554',
      runCommand: vi.fn(),
      spawnProcess: vi.fn(),
    })).resolves.toEqual({
      deviceId: 'emulator-5554',
    });
  });

  it('returns an existing adb serial when the requested AVD is already booted', async () => {
    const spawnProcess = vi.fn();
    const runCommand = vi.fn()
      .mockResolvedValueOnce([
        'List of devices attached',
        'emulator-5554 device product:sdk_gphone64_arm64 model:Pixel_9 device:emu64a transport_id:1',
        '',
      ].join('\n'))
      .mockResolvedValueOnce('Pixel_9_API_35\nOK\n');

    await expect(ensureAndroidSimulatorPreviewDeviceBooted({
      deviceId: 'avd:Pixel_9_API_35',
      runCommand,
      spawnProcess,
      sleepMs: async () => {},
    })).resolves.toEqual({
      deviceId: 'emulator-5554',
    });

    expect(spawnProcess).not.toHaveBeenCalled();
    expect(runCommand).toHaveBeenNthCalledWith(2, 'adb', ['-s', 'emulator-5554', 'emu', 'avd', 'name']);
  });

  it('waits for the requested AVD instead of returning an unrelated new adb serial', async () => {
    const spawnProcess = vi.fn();
    const runCommand = vi.fn()
      .mockResolvedValueOnce([
        'List of devices attached',
        '',
      ].join('\n'))
      .mockResolvedValueOnce([
        'List of devices attached',
        '',
      ].join('\n'))
      .mockResolvedValueOnce([
        'List of devices attached',
        'emulator-5554 device product:sdk_gphone64_arm64 model:Pixel_8 device:emu64a transport_id:1',
        '',
      ].join('\n'))
      .mockResolvedValueOnce('Pixel_8_API_35\nOK\n')
      .mockResolvedValueOnce([
        'List of devices attached',
        'emulator-5554 device product:sdk_gphone64_arm64 model:Pixel_8 device:emu64a transport_id:1',
        'emulator-5556 device product:sdk_gphone64_arm64 model:Pixel_9 device:emu64a transport_id:2',
        '',
      ].join('\n'))
      .mockResolvedValueOnce('Pixel_8_API_35\nOK\n')
      .mockResolvedValueOnce('Pixel_9_API_35\nOK\n')
      .mockResolvedValueOnce('1\n');

    await expect(ensureAndroidSimulatorPreviewDeviceBooted({
      deviceId: 'avd:Pixel_9_API_35',
      runCommand,
      spawnProcess,
      sleepMs: async () => {},
    })).resolves.toEqual({
      deviceId: 'emulator-5556',
    });

    expect(runCommand).toHaveBeenCalledWith('adb', ['-s', 'emulator-5554', 'emu', 'avd', 'name']);
    expect(runCommand).toHaveBeenCalledWith('adb', ['-s', 'emulator-5556', 'emu', 'avd', 'name']);
    expect(runCommand).toHaveBeenCalledWith('adb', ['-s', 'emulator-5556', 'shell', 'getprop', 'sys.boot_completed']);
  });
});
