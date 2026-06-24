import { afterEach, describe, expect, it, vi } from 'vitest';

const { axiosPost } = vi.hoisted(() => ({
  axiosPost: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: axiosPost,
  },
}));

vi.mock('./externalIssueSessionRunTelemetry', () => ({
  logExternalIssueSessionRunInfo: () => {},
  logExternalIssueSessionRunWarn: () => {},
}));

function claimActionResponse() {
  return {
    data: {
      action: {
        id: 'action-1',
        issueRefId: 'issue-1',
        sessionRunId: 'run-1',
        provider: 'github',
        repositoryKey: 'acme/api',
        repositoryConnection: {
          providerBaseUrl: 'https://github.com',
          authKind: 'gh_cli',
        },
        externalIssueRef: {
          issueNumber: 123,
          title: 'Fix state projection',
          url: 'https://github.com/acme/api/issues/123',
        },
        payload: {
          providerChangeUrl: 'https://github.com/acme/api/pull/17',
          providerChangeNumber: 17,
          providerChangeExternalId: 'github-pr-17',
        },
        actionKind: 'issue_link_back',
        executionMode: 'machine_runtime',
        state: 'claimed',
      },
    },
  };
}

describe('providerActionWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    axiosPost.mockReset();
  });

  it('claims queued provider actions and executes them', async () => {
    vi.useFakeTimers();
    axiosPost
      .mockResolvedValueOnce(claimActionResponse())
      .mockResolvedValueOnce({ data: { action: { id: 'action-1', state: 'running' } } })
      .mockResolvedValueOnce({ data: { id: 991, html_url: 'https://github.com/acme/api/issues/123#issuecomment-991' } })
      .mockResolvedValueOnce({ data: { action: { id: 'action-1', state: 'succeeded' } } });

    const { startProviderActionWorker } = await import('./providerActionWorker');
    const worker = startProviderActionWorker({
      token: 'token-1',
      machineId: 'machine-1',
      env: {
        HAPPIER_PROVIDER_ACTION_CLAIM_POLL_MS: '600000',
        HAPPIER_PROVIDER_ACTION_LEASE_MS: '30000',
        HAPPIER_EXTERNAL_ISSUE_GITHUB_TOKEN: 'github-token-1',
      } as NodeJS.ProcessEnv,
    });

    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/provider-actions\/claim$/),
      expect.objectContaining({
        machineId: 'machine-1',
        leaseDurationMs: 30_000,
      }),
      expect.anything(),
    );
    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/provider-actions\/action-1\/start$/),
      { machineId: 'machine-1' },
      expect.anything(),
    );
    expect(axiosPost).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/api/issues/123/comments',
      expect.objectContaining({
        body: expect.stringContaining('https://github.com/acme/api/pull/17'),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer github-token-1',
        }),
      }),
    );
    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/provider-actions\/action-1\/succeed$/),
      expect.objectContaining({
        machineId: 'machine-1',
        providerExternalId: 'github-comment-991',
        summary: expect.stringContaining('GitHub issue comment'),
      }),
      expect.anything(),
    );

    worker.stop();
  });

  it('wakes immediately when a queued provider-action update arrives', async () => {
    vi.useFakeTimers();
    axiosPost.mockResolvedValue({ data: { action: null } });

    const { startProviderActionWorker } = await import('./providerActionWorker');
    const worker = startProviderActionWorker({
      token: 'token-1',
      machineId: 'machine-1',
      env: {
        HAPPIER_PROVIDER_ACTION_CLAIM_POLL_MS: '600000',
      } as NodeJS.ProcessEnv,
    });

    worker.pause();
    worker.resume();
    axiosPost.mockClear();

    worker.handleServerUpdate({
      body: {
        t: 'provider-action-updated',
        state: 'queued',
      },
    } as never);
    await vi.runOnlyPendingTimersAsync();

    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/provider-actions\/claim$/),
      expect.anything(),
      expect.anything(),
    );

    worker.stop();
  });
});
