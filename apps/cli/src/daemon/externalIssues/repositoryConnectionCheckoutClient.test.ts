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

import { createRepositoryConnectionCheckoutClient } from './repositoryConnectionCheckoutClient';

describe('createRepositoryConnectionCheckoutClient', () => {
  beforeEach(() => {
    axiosGet.mockReset();
    axiosPost.mockReset();
  });

  it('lists repository connections and binds a local checkout path with auth headers', async () => {
    axiosGet.mockResolvedValueOnce({
      data: {
        connections: [
          {
            id: 'connection-1',
            provider: 'github',
            providerBaseUrl: 'https://github.com',
            repositoryKey: 'acme/api',
            enabled: true,
          },
        ],
      },
    });
    axiosPost.mockResolvedValueOnce({ data: { ok: true } });

    const client = createRepositoryConnectionCheckoutClient({ token: 'token-1' });
    await client.listConnections({ enabled: true });
    await client.bindLocalCheckout({
      connectionId: 'connection/1',
      machineId: 'machine-1',
      localCheckoutPath: '/repo/api',
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
    expect(axiosPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/repositories\/connections\/connection%2F1\/local-checkout$/),
      {
        machineId: 'machine-1',
        localCheckoutPath: '/repo/api',
      },
      expect.objectContaining({
        timeout: 15_000,
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });
});
