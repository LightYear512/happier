import { describe, expect, it, vi } from 'vitest';

import { ensureIosSimulatorPreviewDeviceBooted, resolveIosSimulatorPreviewDevice } from './resolveIosSimulatorPreviewDevice';

describe('resolveIosSimulatorPreviewDevice', () => {
  it('returns the booted iOS simulator without booting another device', async () => {
    const runCommand = vi.fn(async () => JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
          { name: 'iPhone 17 Pro', udid: 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B', state: 'Booted', isAvailable: true },
        ],
      },
    }));

    await expect(resolveIosSimulatorPreviewDevice({ runCommand })).resolves.toEqual({
      deviceId: 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B',
      deviceName: 'iPhone 17 Pro',
    });

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']);
  });

  it('boots the first available iOS simulator when none is booted', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ devices: {} }))
      .mockResolvedValueOnce(JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
            { name: 'iPhone 17 Pro', udid: 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B', state: 'Shutdown', isAvailable: true },
          ],
        },
      }))
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');

    await expect(resolveIosSimulatorPreviewDevice({ runCommand })).resolves.toEqual({
      deviceId: 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B',
      deviceName: 'iPhone 17 Pro',
    });

    expect(runCommand).toHaveBeenNthCalledWith(2, 'xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
    expect(runCommand).toHaveBeenNthCalledWith(3, 'xcrun', ['simctl', 'boot', 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B']);
    expect(runCommand).toHaveBeenNthCalledWith(4, 'xcrun', ['simctl', 'bootstatus', 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B', '-b']);
  });

  it('boots a specific available iOS simulator before preview streaming', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');

    await expect(ensureIosSimulatorPreviewDeviceBooted({
      deviceId: 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B',
      runCommand,
    })).resolves.toEqual({
      deviceId: 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B',
    });

    expect(runCommand).toHaveBeenNthCalledWith(1, 'xcrun', ['simctl', 'boot', 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B']);
    expect(runCommand).toHaveBeenNthCalledWith(2, 'xcrun', ['simctl', 'bootstatus', 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B', '-b']);
  });

  it('treats an already-booted specific iOS simulator as ready during boot races', async () => {
    const runCommand = vi.fn()
      .mockRejectedValueOnce(new Error('Unable to boot device in current state: Booted'))
      .mockResolvedValueOnce('');

    await expect(ensureIosSimulatorPreviewDeviceBooted({
      deviceId: 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B',
      runCommand,
    })).resolves.toEqual({
      deviceId: 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B',
    });

    expect(runCommand).toHaveBeenNthCalledWith(2, 'xcrun', ['simctl', 'bootstatus', 'F3D78E58-6744-47F9-9FFC-5FA39E6D143B', '-b']);
  });
});
