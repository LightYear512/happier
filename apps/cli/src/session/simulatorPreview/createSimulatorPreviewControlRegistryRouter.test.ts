import { describe, expect, it, vi } from 'vitest';

import { createSimulatorPreviewControlRegistryRouter } from './createSimulatorPreviewControlRegistryRouter';

describe('createSimulatorPreviewControlRegistryRouter', () => {
  it('routes iOS control RPCs to the shared iOS registry after an iOS preview is registered', async () => {
    const android = {
      acquire: vi.fn(async () => ({ ok: false as const, errorCode: 'simulator_preview_not_found' as const, error: 'simulator_preview_not_found' as const })),
      release: vi.fn(async () => ({ ok: true as const, generation: 2, mode: 'idle' as const })),
      sendInput: vi.fn(async () => ({ ok: true as const })),
      reloadApp: vi.fn(async () => ({ ok: true as const })),
      reconnectDevServices: vi.fn(async () => ({ ok: true as const, reconnectedPorts: [] as number[] })),
    };
    const ios = {
      acquire: vi.fn(async () => ({
        ok: true as const,
        leaseId: 'lease_ios_1',
        owner: 'user' as const,
        generation: 1,
        expiresAtMs: 31_000,
        mode: 'user_control' as const,
      })),
      release: vi.fn(async () => ({ ok: true as const, generation: 2, mode: 'idle' as const })),
      sendInput: vi.fn(async () => ({ ok: true as const })),
      reloadApp: vi.fn(async () => ({
        ok: false as const,
        errorCode: 'unsupported_ios_operation' as const,
        error: 'unsupported_ios_operation' as const,
      })),
      reconnectDevServices: vi.fn(async () => ({ ok: true as const, reconnectedPorts: [] as number[] })),
    };
    const router = createSimulatorPreviewControlRegistryRouter({ android, ios });

    router.registerPlatform({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      platform: 'ios',
    });

    await expect(router.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      owner: 'user',
      holderId: 'happier-ui',
      leaseTtlMs: 30_000,
    })).resolves.toEqual({
      ok: true,
      leaseId: 'lease_ios_1',
      owner: 'user',
      generation: 1,
      expiresAtMs: 31_000,
      mode: 'user_control',
    });

    expect(ios.acquire).toHaveBeenCalledTimes(1);
    expect(android.acquire).not.toHaveBeenCalled();
  });
});
