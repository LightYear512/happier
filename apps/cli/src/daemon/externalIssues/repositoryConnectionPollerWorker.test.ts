import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('repositoryConnectionPollerWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    axiosGet.mockReset();
    axiosPost.mockReset();
  });

  it('claims poller-enabled connections, fetches provider events, and pushes non-empty batches', async () => {
    vi.useFakeTimers();
    axiosGet.mockResolvedValueOnce({
      data: {
        connections: [
          {
            id: 'connection-enabled',
            provider: 'github',
            providerBaseUrl: 'https://github.com',
            repositoryKey: 'acme/api',
            enabled: true,
            pollerEnabled: true,
          },
          {
            id: 'connection-disabled',
            provider: 'github',
            providerBaseUrl: 'https://github.com',
            repositoryKey: 'acme/disabled',
            enabled: true,
            pollerEnabled: false,
          },
        ],
      },
    });
    axiosPost
      .mockResolvedValueOnce({ data: { ok: true, connection: { id: 'connection-enabled' } } })
      .mockResolvedValueOnce({ data: { ok: true, connection: { id: 'connection-enabled' } } })
      .mockResolvedValueOnce({ data: { recorded: 1, deduped: 0, issues: [] } });
    const fetchEvents = vi.fn().mockResolvedValue([{
      eventKey: 'github:issues:opened:123',
      occurredAt: 1_700_000_000_000,
      kind: 'issue_opened',
      issueNumber: 123,
      snapshot: {
        title: 'Fix API',
        state: 'open',
      },
    }]);

    const { startRepositoryConnectionPollerWorker } = await import('./repositoryConnectionPollerWorker');
    const worker = startRepositoryConnectionPollerWorker({
      token: 'token-1',
      machineId: 'machine-1',
      env: {
        HAPPIER_EXTERNAL_ISSUE_REPOSITORY_POLLER_INTERVAL_MS: '600000',
        HAPPIER_EXTERNAL_ISSUE_REPOSITORY_POLLER_LEASE_MS: '45000',
      } as NodeJS.ProcessEnv,
      fetchEvents,
    });

    await vi.runOnlyPendingTimersAsync();

    expect(fetchEvents).toHaveBeenCalledTimes(1);
    expect(fetchEvents).toHaveBeenCalledWith(expect.objectContaining({
      id: 'connection-enabled',
      repositoryKey: 'acme/api',
    }));
    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/repositories\/connections\/connection-enabled\/events\/push$/),
      {
        machineId: 'machine-1',
        events: [expect.objectContaining({ eventKey: 'github:issues:opened:123' })],
      },
      expect.anything(),
    );
    expect(axiosPost).not.toHaveBeenCalledWith(
      expect.stringMatching(/connection-disabled/),
      expect.anything(),
      expect.anything(),
    );

    worker.stop();
  });

  it('does not fetch provider events when paused', async () => {
    vi.useFakeTimers();
    axiosGet.mockResolvedValue({ data: { connections: [] } });
    const fetchEvents = vi.fn();

    const { startRepositoryConnectionPollerWorker } = await import('./repositoryConnectionPollerWorker');
    const worker = startRepositoryConnectionPollerWorker({
      token: 'token-1',
      machineId: 'machine-1',
      env: {
        HAPPIER_EXTERNAL_ISSUE_REPOSITORY_POLLER_INTERVAL_MS: '600000',
      } as NodeJS.ProcessEnv,
      fetchEvents,
    });

    worker.pause();
    await worker.refresh();

    expect(fetchEvents).not.toHaveBeenCalled();

    worker.stop();
  });

  it('uses the default GitHub fetcher to normalize issue snapshots', async () => {
    vi.useFakeTimers();
    axiosGet
      .mockResolvedValueOnce({
        data: {
          connections: [
            {
              id: 'connection-github',
              provider: 'github',
              providerBaseUrl: 'https://github.com',
              repositoryKey: 'acme/api',
              enabled: true,
              pollerEnabled: true,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 9001,
            number: 123,
            title: 'Fix API',
            state: 'open',
            html_url: 'https://github.com/acme/api/issues/123',
            updated_at: '2026-06-23T09:30:00Z',
            labels: [{ name: 'bug' }],
            assignees: [{ login: 'ada' }],
          },
          {
            id: 9002,
            number: 17,
            title: 'PR should be ignored',
            state: 'open',
            html_url: 'https://github.com/acme/api/pull/17',
            updated_at: '2026-06-23T09:31:00Z',
            pull_request: {},
          },
        ],
      });
    axiosPost
      .mockResolvedValueOnce({ data: { ok: true, connection: { id: 'connection-github' } } })
      .mockResolvedValueOnce({ data: { ok: true, connection: { id: 'connection-github' } } })
      .mockResolvedValueOnce({ data: { recorded: 1, deduped: 0, issues: [] } });

    const { startRepositoryConnectionPollerWorker } = await import('./repositoryConnectionPollerWorker');
    const worker = startRepositoryConnectionPollerWorker({
      token: 'token-1',
      machineId: 'machine-1',
      env: {
        HAPPIER_EXTERNAL_ISSUE_REPOSITORY_POLLER_INTERVAL_MS: '600000',
        HAPPIER_EXTERNAL_ISSUE_REPOSITORY_POLLER_LEASE_MS: '45000',
        HAPPIER_EXTERNAL_ISSUE_GITHUB_TOKEN: 'github-token-1',
      } as NodeJS.ProcessEnv,
    });

    await vi.runOnlyPendingTimersAsync();

    expect(axiosGet).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/api/issues?state=open&sort=updated&direction=desc&per_page=50',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer github-token-1',
        }),
      }),
    );
    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/repositories\/connections\/connection-github\/events\/push$/),
      {
        machineId: 'machine-1',
        events: [
          expect.objectContaining({
            eventKey: 'github:acme/api:issue:123:2026-06-23T09:30:00Z',
            kind: 'issue_snapshot',
            issueNumber: 123,
            occurredAt: Date.parse('2026-06-23T09:30:00Z'),
            snapshot: expect.objectContaining({
              title: 'Fix API',
              state: 'open',
              url: 'https://github.com/acme/api/issues/123',
              labels: ['bug'],
              assignees: ['ada'],
            }),
          }),
        ],
      },
      expect.anything(),
    );

    worker.stop();
  });
});
