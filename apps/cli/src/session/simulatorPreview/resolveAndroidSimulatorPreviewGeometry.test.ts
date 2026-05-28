import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

function createMockChildProcess(): ChildProcessWithoutNullStreams {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = { end: vi.fn() };
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(() => true),
  });
  // Boundary fixture: the production code only uses EventEmitter, stdio, and kill.
  return child as unknown as ChildProcessWithoutNullStreams;
}

describe('resolveAndroidSimulatorPreviewGeometry', () => {
  it('uses adb wm override size when present', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);
    const { resolveAndroidSimulatorPreviewGeometry } = await import('./resolveAndroidSimulatorPreviewGeometry');

    const geometry = resolveAndroidSimulatorPreviewGeometry({
      adbPath: 'adb',
      deviceId: 'emulator-5554',
    });
    child.stdout.emit('data', Buffer.from('Physical size: 1080x2400\nOverride size: 720x1600\n'));
    child.emit('close', 0);

    await expect(geometry).resolves.toEqual({ deviceWidth: 720, deviceHeight: 1600 });
    expect(mockSpawn).toHaveBeenCalledWith('adb', ['-s', 'emulator-5554', 'shell', 'wm', 'size'], expect.any(Object));
  });

  it('rejects malformed adb wm size output', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);
    const { resolveAndroidSimulatorPreviewGeometry } = await import('./resolveAndroidSimulatorPreviewGeometry');

    const geometry = resolveAndroidSimulatorPreviewGeometry({ adbPath: 'adb' });
    child.stdout.emit('data', Buffer.from('Physical size: unknown\n'));
    child.emit('close', 0);

    await expect(geometry).rejects.toThrow('Unable to parse Android display size');
  });
});
