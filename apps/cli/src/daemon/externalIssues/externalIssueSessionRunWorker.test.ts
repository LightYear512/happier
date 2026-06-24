import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpawnSessionResult } from '@/rpc/handlers/registerSessionHandlers';

const { axiosGet, axiosPost } = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  axiosPost: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    get: axiosGet,
    post: axiosPost,
  },
}));

vi.mock('./externalIssueSessionRunTelemetry', () => ({
  logExternalIssueSessionRunInfo: () => {},
  logExternalIssueSessionRunWarn: () => {},
}));

function claimResponse() {
  return {
    data: {
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        generation: 0,
        state: 'claimed',
      },
    },
  };
}

function detailResponse() {
  return {
    data: {
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        generation: 0,
        state: 'claimed',
      },
      session: {
        id: 'session-1',
        metadata: JSON.stringify({ workingDirectory: '/repo/app' }),
      },
      externalIssue: {
        issueNumber: 8,
        title: 'Handle webhook replay',
        url: 'https://github.example.test/org/repo/issues/8',
      },
    },
  };
}

describe('externalIssueSessionRunWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    axiosGet.mockReset();
    axiosPost.mockReset();
  });

  it('claims queued session runs and executes them through spawnSession', async () => {
    vi.useFakeTimers();
    axiosPost
      .mockResolvedValueOnce(claimResponse())
      .mockResolvedValueOnce({ data: { run: { id: 'run-1' } } })
      .mockResolvedValueOnce({ data: { ok: true } });
    axiosGet.mockResolvedValueOnce(detailResponse());
    const spawnSession = vi.fn(async (): Promise<SpawnSessionResult> => ({ type: 'success', sessionId: 'session-1' }));

    const { startExternalIssueSessionRunWorker } = await import('./externalIssueSessionRunWorker');
    const worker = startExternalIssueSessionRunWorker({
      token: 'token-1',
      machineId: 'machine-1',
      spawnSession,
      env: {
        HAPPIER_EXTERNAL_ISSUE_SESSION_RUN_CLAIM_POLL_MS: '600000',
        HAPPIER_EXTERNAL_ISSUE_SESSION_RUN_LEASE_MS: '30000',
      } as NodeJS.ProcessEnv,
    });

    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    expect(spawnSession).toHaveBeenCalledWith(expect.objectContaining({
      existingSessionId: 'session-1',
      directory: '/repo/app',
    }));

    worker.stop();
  });

  it('wakes immediately when a queued session-run update arrives', async () => {
    vi.useFakeTimers();
    axiosPost.mockResolvedValue({ data: { run: null } });

    const { startExternalIssueSessionRunWorker } = await import('./externalIssueSessionRunWorker');
    const worker = startExternalIssueSessionRunWorker({
      token: 'token-1',
      machineId: 'machine-1',
      spawnSession: vi.fn(async (): Promise<SpawnSessionResult> => ({ type: 'success', sessionId: 'session-1' })),
      env: {
        HAPPIER_EXTERNAL_ISSUE_SESSION_RUN_CLAIM_POLL_MS: '600000',
      } as NodeJS.ProcessEnv,
    });

    worker.pause();
    worker.resume();
    axiosPost.mockClear();

    worker.handleServerUpdate({
      body: {
        t: 'session-run-updated',
        state: 'queued',
      },
    } as never);
    await vi.runOnlyPendingTimersAsync();

    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/session-runs\/claim$/),
      expect.anything(),
      expect.anything(),
    );

    worker.stop();
  });
});
