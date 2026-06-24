import { describe, expect, it, vi } from 'vitest';

const { axiosPost } = vi.hoisted(() => ({
  axiosPost: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: axiosPost,
  },
}));

describe('executeClaimedProviderAction', () => {
  it('writes a GitHub issue link-back comment before marking the action succeeded', async () => {
    axiosPost.mockResolvedValueOnce({
      data: {
        id: 991,
        html_url: 'https://github.com/acme/api/issues/123#issuecomment-991',
      },
    });
    const client = {
      startAction: vi.fn(async () => {}),
      heartbeatAction: vi.fn(async () => {}),
      succeedAction: vi.fn(async () => {}),
      failAction: vi.fn(async () => {}),
    };

    const { executeClaimedProviderAction } = await import('./providerActionExecutor');
    await executeClaimedProviderAction({
      machineId: 'machine-1',
      client,
      heartbeatMs: 60_000,
      leaseDurationMs: 120_000,
      env: {
        HAPPIER_EXTERNAL_ISSUE_GITHUB_TOKEN: 'github-token-1',
      } as NodeJS.ProcessEnv,
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
          title: 'Fix issue state',
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
    });

    expect(client.startAction).toHaveBeenCalledWith({
      actionId: 'action-1',
      machineId: 'machine-1',
    });
    expect(axiosPost).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/api/issues/123/comments',
      {
        body: expect.stringContaining('https://github.com/acme/api/pull/17'),
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer github-token-1',
        }),
        timeout: 15_000,
      }),
    );
    expect(client.succeedAction).toHaveBeenCalledWith({
      actionId: 'action-1',
      machineId: 'machine-1',
      providerExternalId: 'github-comment-991',
      summary: expect.stringContaining('GitHub issue comment'),
    });
    expect(client.failAction).not.toHaveBeenCalled();
  });

  it('fails unsupported provider actions without retrying', async () => {
    const client = {
      startAction: vi.fn(async () => {}),
      heartbeatAction: vi.fn(async () => {}),
      succeedAction: vi.fn(async () => {}),
      failAction: vi.fn(async () => {}),
    };

    const { executeClaimedProviderAction } = await import('./providerActionExecutor');
    await executeClaimedProviderAction({
      machineId: 'machine-1',
      client,
      heartbeatMs: 60_000,
      leaseDurationMs: 120_000,
      action: {
        id: 'action-unsupported',
        actionKind: 'unknown_action',
        executionMode: 'machine_runtime',
        state: 'claimed',
      },
    });

    expect(client.succeedAction).not.toHaveBeenCalled();
    expect(client.failAction).toHaveBeenCalledWith({
      actionId: 'action-unsupported',
      machineId: 'machine-1',
      errorCode: 'unsupported_provider_action',
      errorMessage: expect.stringContaining('unknown_action'),
      retryRecommended: false,
    });
  });

  it('supports an explicit dry-run mode without touching GitHub', async () => {
    axiosPost.mockClear();
    const client = {
      startAction: vi.fn(async () => {}),
      heartbeatAction: vi.fn(async () => {}),
      succeedAction: vi.fn(async () => {}),
      failAction: vi.fn(async () => {}),
    };

    const { executeClaimedProviderAction } = await import('./providerActionExecutor');
    await executeClaimedProviderAction({
      machineId: 'machine-1',
      client,
      heartbeatMs: 60_000,
      leaseDurationMs: 120_000,
      env: {
        HAPPIER_EXTERNAL_ISSUE_PROVIDER_ACTION_DRY_RUN: '1',
      } as NodeJS.ProcessEnv,
      action: {
        id: 'action-dry-run',
        actionKind: 'issue_link_back',
        executionMode: 'machine_runtime',
        provider: 'github',
        repositoryKey: 'acme/api',
        state: 'claimed',
        externalIssueRef: {
          issueNumber: 123,
        },
      },
    });

    expect(axiosPost).not.toHaveBeenCalled();
    expect(client.succeedAction).toHaveBeenCalledWith({
      actionId: 'action-dry-run',
      machineId: 'machine-1',
      providerExternalId: 'github-link-back-dry-run:action-dry-run',
      summary: expect.stringContaining('dry run'),
    });
    expect(client.failAction).not.toHaveBeenCalled();
  });

  it('validates dry-run GitHub link-back inputs before marking the action succeeded', async () => {
    axiosPost.mockClear();
    const client = {
      startAction: vi.fn(async () => {}),
      heartbeatAction: vi.fn(async () => {}),
      succeedAction: vi.fn(async () => {}),
      failAction: vi.fn(async () => {}),
    };

    const { executeClaimedProviderAction } = await import('./providerActionExecutor');
    await executeClaimedProviderAction({
      machineId: 'machine-1',
      client,
      heartbeatMs: 60_000,
      leaseDurationMs: 120_000,
      env: {
        HAPPIER_EXTERNAL_ISSUE_PROVIDER_ACTION_DRY_RUN: '1',
      } as NodeJS.ProcessEnv,
      action: {
        id: 'action-dry-run-invalid',
        actionKind: 'issue_link_back',
        executionMode: 'machine_runtime',
        provider: 'github',
        repositoryKey: 'acme/api',
        state: 'claimed',
      },
    });

    expect(axiosPost).not.toHaveBeenCalled();
    expect(client.succeedAction).not.toHaveBeenCalled();
    expect(client.failAction).toHaveBeenCalledWith({
      actionId: 'action-dry-run-invalid',
      machineId: 'machine-1',
      errorCode: 'missing_issue_number',
      errorMessage: expect.stringContaining('issue number'),
      retryRecommended: false,
    });
  });
});
