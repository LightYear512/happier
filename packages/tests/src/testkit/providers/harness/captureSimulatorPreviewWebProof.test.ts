import { describe, expect, it, vi } from 'vitest';

import { gotoDomContentLoadedWithRetries } from '../../uiE2e/pageNavigation';
import { navigateToSimulatorPreviewProofSession } from './captureSimulatorPreviewWebProof';

vi.mock('../../uiE2e/pageNavigation', () => ({
  gotoDomContentLoadedWithRetries: vi.fn(async () => undefined),
  normalizeLoopbackBaseUrl: (value: string) => value,
}));

describe('navigateToSimulatorPreviewProofSession', () => {
  it('loads the exported app shell before switching to the session route', async () => {
    const page = {
      evaluate: vi.fn(async () => undefined),
    };

    await navigateToSimulatorPreviewProofSession(
      page as never,
      'http://127.0.0.1:3000',
      'sess_123',
    );

    expect(gotoDomContentLoadedWithRetries).toHaveBeenCalledWith(
      page,
      'http://127.0.0.1:3000/?happier_hmr=0',
      180_000,
    );
    expect(page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      '/session/sess_123?happier_hmr=0',
    );
  });
});
