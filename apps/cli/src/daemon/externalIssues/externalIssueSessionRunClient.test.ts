import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { createExternalIssueSessionRunClient } from './externalIssueSessionRunClient';

describe('createExternalIssueSessionRunClient', () => {
  beforeEach(() => {
    axiosGet.mockReset();
    axiosPost.mockReset();
  });

  it('claims and loads session-run details with auth headers', async () => {
    axiosPost.mockResolvedValueOnce({ data: { run: { id: 'run/1' } } });
    axiosGet.mockResolvedValueOnce({ data: { run: { id: 'run/1' }, session: null } });

    const client = createExternalIssueSessionRunClient({ token: 'token-1' });
    await client.claimRun({ machineId: 'machine-1', leaseDurationMs: 45_000 });
    await client.getRun('run/1');

    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/session-runs\/claim$/),
      {
        machineId: 'machine-1',
        leaseDurationMs: 45_000,
      },
      expect.objectContaining({
        timeout: 15_000,
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/session-runs\/run%2F1$/),
      expect.objectContaining({
        timeout: 15_000,
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
        }),
      }),
    );
  });

  it('sends lifecycle updates with the claimed generation', async () => {
    axiosPost.mockResolvedValue({ data: undefined });

    const client = createExternalIssueSessionRunClient({ token: 'token-1' });
    await client.startRun({ runId: 'run/1', machineId: 'machine-1', generation: 2 });
    await client.heartbeatRun({ runId: 'run/1', machineId: 'machine-1', generation: 2, leaseDurationMs: 30_000 });
    await client.succeedRun({ runId: 'run/1', machineId: 'machine-1', generation: 2, producedSessionId: 'session-1' });
    await client.failRun({ runId: 'run/1', machineId: 'machine-1', generation: 2, errorCode: 'x', errorMessage: 'y' });
    await client.expireStale({ machineId: 'machine-1', limit: 25 });

    expect(axiosPost.mock.calls.map((call) => call[0])).toEqual([
      expect.stringMatching(/\/v2\/session-runs\/run%2F1\/start$/),
      expect.stringMatching(/\/v2\/session-runs\/run%2F1\/heartbeat$/),
      expect.stringMatching(/\/v2\/session-runs\/run%2F1\/succeed$/),
      expect.stringMatching(/\/v2\/session-runs\/run%2F1\/fail$/),
      expect.stringMatching(/\/v2\/session-runs\/expire-stale$/),
    ]);
    expect(axiosPost.mock.calls[0][1]).toMatchObject({ generation: 2 });
    expect(axiosPost.mock.calls[1][1]).toMatchObject({ generation: 2, leaseDurationMs: 30_000 });
    expect(axiosPost.mock.calls[2][1]).toMatchObject({ generation: 2, producedSessionId: 'session-1' });
    expect(axiosPost.mock.calls[3][1]).toMatchObject({ generation: 2, errorCode: 'x', errorMessage: 'y' });
  });
});
