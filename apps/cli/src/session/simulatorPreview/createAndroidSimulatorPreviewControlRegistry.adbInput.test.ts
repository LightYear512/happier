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

describe('createAndroidSimulatorPreviewControlRegistry adb input', () => {
  it('escapes Android text input before passing it through adb shell', async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValueOnce(child);
    const { createAndroidSimulatorPreviewControlRegistry } = await import('./createAndroidSimulatorPreviewControlRegistry');
    const registry = createAndroidSimulatorPreviewControlRegistry({
      nowMs: () => 1_000,
      randomId: () => 'lease_user_1',
    });
    registry.registerAndroidPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      deviceId: 'emulator-5554',
      deviceWidth: 1080,
      deviceHeight: 1920,
    });
    await registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
    });

    const send = registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
      input: { type: 'text', text: 'hello 100% & done' },
    });
    child.emit('close', 0);

    await expect(send).resolves.toEqual({ ok: true });
    expect(mockSpawn).toHaveBeenCalledWith('adb', [
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'text',
      'hello%s100%25%s\\&%sdone',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
  });
});
