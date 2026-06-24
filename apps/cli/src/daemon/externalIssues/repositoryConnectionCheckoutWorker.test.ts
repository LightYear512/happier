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

describe('repositoryConnectionCheckoutWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    axiosGet.mockReset();
    axiosPost.mockReset();
  });

  it('binds the current checkout only to matching repository connections', async () => {
    vi.useFakeTimers();
    axiosGet.mockResolvedValueOnce({
      data: {
        connections: [
          {
            id: 'connection-match',
            provider: 'github',
            providerBaseUrl: 'https://github.com',
            repositoryKey: 'acme/api',
            enabled: true,
          },
          {
            id: 'connection-other',
            provider: 'github',
            providerBaseUrl: 'https://github.com',
            repositoryKey: 'acme/other',
            enabled: true,
          },
        ],
      },
    });
    axiosPost.mockResolvedValue({ data: { ok: true } });

    const { startRepositoryConnectionCheckoutWorker } = await import('./repositoryConnectionCheckoutWorker');
    const worker = startRepositoryConnectionCheckoutWorker({
      token: 'token-1',
      machineId: 'machine-1',
      env: {
        HAPPIER_EXTERNAL_ISSUE_CHECKOUT_SYNC_INTERVAL_MS: '600000',
      } as NodeJS.ProcessEnv,
      resolveCheckout: async () => ({
        localCheckoutPath: '/repo/api',
        providerBaseUrl: 'https://github.com',
        repositoryKey: 'acme/api',
      }),
    });

    await vi.runOnlyPendingTimersAsync();

    expect(axiosGet).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/repositories\/connections\?enabled=true&repositoryKey=acme%2Fapi$/),
      expect.anything(),
    );
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/repositories\/connections\/connection-match\/local-checkout$/),
      expect.objectContaining({
        machineId: 'machine-1',
        localCheckoutPath: '/repo/api',
      }),
      expect.anything(),
    );

    worker.stop();
  });

  it('refreshes on demand after being resumed', async () => {
    vi.useFakeTimers();
    axiosGet.mockResolvedValue({
      data: {
        connections: [
          {
            id: 'connection-match',
            provider: 'github',
            providerBaseUrl: 'https://github.com',
            repositoryKey: 'acme/api',
            enabled: true,
          },
        ],
      },
    });
    axiosPost.mockResolvedValue({ data: { ok: true } });

    const { startRepositoryConnectionCheckoutWorker } = await import('./repositoryConnectionCheckoutWorker');
    const worker = startRepositoryConnectionCheckoutWorker({
      token: 'token-1',
      machineId: 'machine-1',
      env: {
        HAPPIER_EXTERNAL_ISSUE_CHECKOUT_SYNC_INTERVAL_MS: '600000',
      } as NodeJS.ProcessEnv,
      resolveCheckout: async () => ({
        localCheckoutPath: '/repo/api',
        providerBaseUrl: 'https://github.com',
        repositoryKey: 'acme/api',
      }),
    });

    worker.pause();
    axiosGet.mockClear();
    await worker.refresh();
    expect(axiosGet).not.toHaveBeenCalled();

    worker.resume();
    worker.refresh();
    await vi.runOnlyPendingTimersAsync();

    expect(axiosGet).toHaveBeenCalled();

    worker.stop();
  });
});
