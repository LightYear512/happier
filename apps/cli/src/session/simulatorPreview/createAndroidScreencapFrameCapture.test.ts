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

describe('createAndroidScreencapFrameCapture', () => {
  it('kills a hung adb screencap command after the capture timeout', async () => {
    vi.useFakeTimers();
    try {
      const child = createMockChildProcess();
      mockSpawn.mockReturnValueOnce(child);

      const { createAndroidScreencapFrameCapture } = await import('./createAndroidScreencapFrameCapture');
      const captureFrame = createAndroidScreencapFrameCapture({
        adbPath: 'adb',
        timeoutMs: 50,
      });

      const capture = captureFrame();
      const captureExpectation = expect(capture).rejects.toThrow('adb screencap timed out after 50ms');
      await vi.advanceTimersByTimeAsync(50);

      await captureExpectation;
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
});
