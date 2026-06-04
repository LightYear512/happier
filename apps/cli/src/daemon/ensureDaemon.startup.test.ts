import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./controlClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./controlClient')>();
  return {
    ...actual,
    inspectDaemonRunningStateAndCleanupStaleState: vi.fn(async () => ({ status: 'not-running' as const })),
    isDaemonRunningCurrentlyInstalledHappyVersion: vi.fn(),
  };
});

vi.mock('@/daemon/runtime/spawnDetachedDaemonStartSync', () => ({
  spawnDetachedDaemonStartSync: vi.fn(),
}));

vi.mock('@/daemon/ownership/daemonServiceInventory', () => ({
  evaluateDaemonStartupServiceConflict: vi.fn(async () => ({ kind: 'none' as const })),
  renderDaemonInstalledServiceConflict: vi.fn(),
}));

import { ensureDaemonRunningForSessionCommand } from './ensureDaemon';
import { isDaemonRunningCurrentlyInstalledHappyVersion } from './controlClient';
import { spawnDetachedDaemonStartSync } from '@/daemon/runtime/spawnDetachedDaemonStartSync';

describe('ensureDaemonRunningForSessionCommand', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS;
    delete process.env.HAPPIER_DAEMON_START_WAIT_POLL_MS;
  });

  it('polls daemon readiness after spawning', async () => {
    process.env.HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS = '100';
    process.env.HAPPIER_DAEMON_START_WAIT_POLL_MS = '1';
    const isRunning = vi.mocked(isDaemonRunningCurrentlyInstalledHappyVersion);
    isRunning
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const unref = vi.fn();
    vi.mocked(spawnDetachedDaemonStartSync).mockResolvedValue({ unref } as any);

    await ensureDaemonRunningForSessionCommand();

    expect(spawnDetachedDaemonStartSync).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(isRunning).toHaveBeenCalledTimes(3);
  });
});
