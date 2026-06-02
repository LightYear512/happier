import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('captures JPEG frames from a specific simulator UDID through xcrun simctl', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);

    const { createIosSimctlFrameCapture } = await import('./createIosSimctlFrameCapture');
    const captureFrame = createIosSimctlFrameCapture({
      deviceId: 'A1B2-C3D4',
      timeoutMs: 500,
    });

    const capture = captureFrame();
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });
    const spawnArgs = mockSpawn.mock.calls[0]?.[1];
    if (!Array.isArray(spawnArgs)) {
      throw new Error('expected xcrun spawn args');
    }
    const outputPath = spawnArgs.at(-1);
    if (typeof outputPath !== 'string' || outputPath === '-') {
      throw new Error('expected simctl screenshot output file path');
    }
    await writeFile(outputPath, Buffer.from('jpeg-frame'));
    child.emit('close', 0);

    await expect(capture).resolves.toEqual({
      body: Buffer.from('jpeg-frame'),
      contentType: 'image/jpeg',
    });
    expect(spawnArgs.slice(0, -1)).toEqual(['simctl', 'io', 'A1B2-C3D4', 'screenshot', '--type=jpeg']);
  });

  it('kills a hung simctl screenshot command after the capture timeout', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);

    const { createIosSimctlFrameCapture } = await import('./createIosSimctlFrameCapture');
    const captureFrame = createIosSimctlFrameCapture({
      xcrunPath: 'xcrun',
      timeoutMs: 50,
    });

    const capture = captureFrame();
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });

    await expect(capture).rejects.toThrow('xcrun simctl screenshot timed out after 50ms');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
