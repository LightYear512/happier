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

import { createRepositoryConnectionPollerClient } from './repositoryConnectionPollerClient';

describe('createRepositoryConnectionPollerClient', () => {
  beforeEach(() => {
    axiosGet.mockReset();
    axiosPost.mockReset();
  });

  it('claims poll leases, heartbeats them, and pushes normalized events with auth headers', async () => {
    axiosGet.mockResolvedValueOnce({
      data: {
        connections: [
          {
            id: 'connection-1',
            provider: 'github',
            providerBaseUrl: 'https://github.com',
            repositoryKey: 'acme/api',
            enabled: true,
            pollerEnabled: true,
          },
        ],
      },
    });
    axiosPost
      .mockResolvedValueOnce({ data: { ok: true, connection: { id: 'connection-1' } } })
      .mockResolvedValueOnce({ data: { ok: true, connection: { id: 'connection-1' } } })
      .mockResolvedValueOnce({ data: { recorded: 1, deduped: 0, issues: [] } });

    const client = createRepositoryConnectionPollerClient({ token: 'token-1' });
    await client.listConnections({ enabled: true });
    await client.claimPollLease({
      connectionId: 'connection/1',
      machineId: 'machine-1',
      leaseDurationMs: 45_000,
    });
    await client.heartbeatPollLease({
      connectionId: 'connection/1',
      machineId: 'machine-1',
      leaseDurationMs: 45_000,
    });
    await client.pushEvents({
      connectionId: 'connection/1',
      machineId: 'machine-1',
      events: [{
        eventKey: 'github:issue:1',
        occurredAt: 1_700_000_000_000,
        kind: 'issue_opened',
        issueNumber: 123,
        snapshot: {
          title: 'Fix API',
          state: 'open',
        },
      }],
    });

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/repositories\/connections\?enabled=true$/),
      expect.objectContaining({
        timeout: 15_000,
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
        }),
      }),
    );
    expect(axiosPost).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/v2\/repositories\/connections\/connection%2F1\/poller\/claim$/),
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
    expect(axiosPost).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/v2\/repositories\/connections\/connection%2F1\/poller\/heartbeat$/),
      {
        machineId: 'machine-1',
        leaseDurationMs: 45_000,
      },
      expect.anything(),
    );
    expect(axiosPost).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/\/v2\/repositories\/connections\/connection%2F1\/events\/push$/),
      {
        machineId: 'machine-1',
        events: [expect.objectContaining({ eventKey: 'github:issue:1' })],
      },
      expect.anything(),
    );
  });
});
