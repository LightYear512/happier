import { describe, expect, it, vi } from 'vitest';
import type { SpawnSessionResult } from '@/rpc/handlers/registerSessionHandlers';
import { executeClaimedExternalIssueSessionRun } from './externalIssueSessionRunExecutor';
import type { ExternalIssueSessionRunDetail } from './externalIssueSessionRunTypes';

function buildRunDetail(overrides: Partial<ExternalIssueSessionRunDetail> = {}): ExternalIssueSessionRunDetail {
  return {
    run: {
      id: 'run-1',
      sessionId: 'session-1',
      generation: 3,
      state: 'claimed',
    },
    session: {
      id: 'session-1',
      metadata: JSON.stringify({ workingDirectory: '/repo/app' }),
    },
    externalIssue: {
      issueNumber: 42,
      title: 'Fix flaky checkout',
      url: 'https://github.example.test/org/repo/issues/42',
    },
    ...overrides,
  };
}

describe('executeClaimedExternalIssueSessionRun', () => {
  it('starts an existing issue session, spawns it with issue context, and marks the run succeeded', async () => {
    const claimClient = {
      startRun: vi.fn(async () => {}),
      heartbeatRun: vi.fn(async () => {}),
      succeedRun: vi.fn(async () => {}),
      failRun: vi.fn(async () => {}),
    };
    const spawnSession = vi.fn(async (): Promise<SpawnSessionResult> => ({
      type: 'success',
      sessionId: 'session-1',
    }));

    await executeClaimedExternalIssueSessionRun({
      machineId: 'machine-1',
      claimClient,
      spawnSession,
      heartbeatMs: 60_000,
      leaseDurationMs: 120_000,
      detail: buildRunDetail(),
    });

    expect(claimClient.startRun).toHaveBeenCalledWith({
      runId: 'run-1',
      machineId: 'machine-1',
      generation: 3,
    });
    expect(spawnSession).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/repo/app',
      existingSessionId: 'session-1',
      sessionId: 'session-1',
      machineId: 'machine-1',
      spawnNonce: 'external-issue-session-run:run-1:3',
      initialPrompt: expect.stringContaining('Fix flaky checkout'),
    }));
    expect(claimClient.succeedRun).toHaveBeenCalledWith({
      runId: 'run-1',
      machineId: 'machine-1',
      generation: 3,
      producedSessionId: 'session-1',
    });
    expect(claimClient.failRun).not.toHaveBeenCalled();
  });

  it('marks the run failed when the claimed session has no working directory', async () => {
    const claimClient = {
      startRun: vi.fn(async () => {}),
      heartbeatRun: vi.fn(async () => {}),
      succeedRun: vi.fn(async () => {}),
      failRun: vi.fn(async () => {}),
    };
    const spawnSession = vi.fn(async (): Promise<SpawnSessionResult> => ({
      type: 'success',
      sessionId: 'session-1',
    }));

    await executeClaimedExternalIssueSessionRun({
      machineId: 'machine-1',
      claimClient,
      spawnSession,
      heartbeatMs: 60_000,
      leaseDurationMs: 120_000,
      detail: buildRunDetail({
        session: {
          id: 'session-1',
          metadata: 'external-issue-session',
        },
      }),
    });

    expect(spawnSession).not.toHaveBeenCalled();
    expect(claimClient.failRun).toHaveBeenCalledWith({
      runId: 'run-1',
      machineId: 'machine-1',
      generation: 3,
      errorCode: 'missing_working_directory',
      errorMessage: expect.stringContaining('working directory'),
    });
  });

  it('uses the repository connection checkout path for auto-created issue sessions', async () => {
    const claimClient = {
      startRun: vi.fn(async () => {}),
      heartbeatRun: vi.fn(async () => {}),
      succeedRun: vi.fn(async () => {}),
      failRun: vi.fn(async () => {}),
    };
    const spawnSession = vi.fn(async (): Promise<SpawnSessionResult> => ({
      type: 'success',
      sessionId: 'session-1',
    }));

    await executeClaimedExternalIssueSessionRun({
      machineId: 'machine-1',
      claimClient,
      spawnSession,
      heartbeatMs: 60_000,
      leaseDurationMs: 120_000,
      detail: buildRunDetail({
        session: {
          id: 'session-1',
          metadata: 'external-issue-session',
        },
        repositoryConnection: {
          id: 'repo-connection-1',
          capabilities: {
            localCheckoutPath: '/repo/from-connection',
          },
        },
      }),
    });

    expect(spawnSession).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/repo/from-connection',
      existingSessionId: 'session-1',
      sessionId: 'session-1',
    }));
    expect(claimClient.succeedRun).toHaveBeenCalledWith({
      runId: 'run-1',
      machineId: 'machine-1',
      generation: 3,
      producedSessionId: 'session-1',
    });
    expect(claimClient.failRun).not.toHaveBeenCalled();
  });
});
