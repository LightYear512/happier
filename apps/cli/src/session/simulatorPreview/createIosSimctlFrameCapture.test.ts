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

describe('createIosSimctlFrameCapture', () => {
  it('captures JPEG frames from a specific simulator UDID through xcrun simctl', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);

    const { createIosSimctlFrameCapture } = await import('./createIosSimctlFrameCapture');
    const captureFrame = createIosSimctlFrameCapture({
      deviceId: 'A1B2-C3D4',
      timeoutMs: 500,
    });

    const capture = captureFrame();
    child.stdout.emit('data', Buffer.from('jpeg-frame'));
    child.emit('close', 0);

    await expect(capture).resolves.toEqual({
      body: Buffer.from('jpeg-frame'),
      contentType: 'image/jpeg',
    });
    expect(mockSpawn).toHaveBeenCalledWith('xcrun', ['simctl', 'io', 'A1B2-C3D4', 'screenshot', '--type=jpeg', '-'], expect.any(Object));
  });

  it('kills a hung simctl screenshot command after the capture timeout', async () => {
    vi.useFakeTimers();
    try {
      const child = createMockChildProcess();
      mockSpawn.mockReturnValueOnce(child);

      const { createIosSimctlFrameCapture } = await import('./createIosSimctlFrameCapture');
      const captureFrame = createIosSimctlFrameCapture({
        xcrunPath: 'xcrun',
        timeoutMs: 50,
      });

      const capture = captureFrame();
      const captureExpectation = expect(capture).rejects.toThrow('xcrun simctl screenshot timed out after 50ms');
      await vi.advanceTimersByTimeAsync(50);

      await captureExpectation;
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
});
