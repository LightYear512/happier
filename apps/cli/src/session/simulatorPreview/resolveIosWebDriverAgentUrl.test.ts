import { describe, expect, it, vi } from 'vitest';

import { resolveIosWebDriverAgentUrl } from './resolveIosWebDriverAgentUrl';

describe('resolveIosWebDriverAgentUrl', () => {
  it('prefers a configured iOS WebDriverAgent URL', async () => {
    const fetchStatus = vi.fn();

    await expect(resolveIosWebDriverAgentUrl({
      env: { HAPPIER_IOS_WDA_URL: ' http://127.0.0.1:8100/ ' } as NodeJS.ProcessEnv,
      fetchStatus,
    })).resolves.toBe('http://127.0.0.1:8100');

    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('uses a running local Appium server before falling back to raw WDA', async () => {
    const fetchStatus = vi.fn(async (url: string) => url === 'http://127.0.0.1:4723/status'
      ? { ok: true }
      : { ok: false });

    await expect(resolveIosWebDriverAgentUrl({ fetchStatus })).resolves.toBe('http://127.0.0.1:4723');
  });
});
