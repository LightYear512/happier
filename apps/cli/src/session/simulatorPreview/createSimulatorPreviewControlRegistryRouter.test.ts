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
      clearSessionPreviews: vi.fn(),
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
      clearSessionPreviews: vi.fn(),
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

  it('clears registered preview platforms by session and platform while preserving an excluded preview', () => {
    const android = {
      acquire: vi.fn(),
      release: vi.fn(),
      sendInput: vi.fn(),
      reloadApp: vi.fn(),
      reconnectDevServices: vi.fn(),
      clearSessionPreviews: vi.fn(),
    };
    const ios = {
      acquire: vi.fn(),
      release: vi.fn(),
      sendInput: vi.fn(),
      reloadApp: vi.fn(),
      reconnectDevServices: vi.fn(),
      clearSessionPreviews: vi.fn(),
    };
    const platforms = new Map([
      ['sess_1\u0000sim_android_1', 'android' as const],
      ['sess_1\u0000sim_ios_old', 'ios' as const],
      ['sess_1\u0000sim_ios_active', 'ios' as const],
      ['sess_2\u0000sim_ios_2', 'ios' as const],
    ]);
    const router = createSimulatorPreviewControlRegistryRouter({ android, ios, platforms });

    router.clearSessionPreviews({
      sessionId: 'sess_1',
      platform: 'ios',
      excludeSimulatorSessionId: 'sim_ios_active',
    });

    expect(android.clearSessionPreviews).not.toHaveBeenCalled();
    expect(ios.clearSessionPreviews).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      excludeSimulatorSessionId: 'sim_ios_active',
    });
    expect(platforms.has('sess_1\u0000sim_android_1')).toBe(true);
    expect(platforms.has('sess_1\u0000sim_ios_old')).toBe(false);
    expect(platforms.has('sess_1\u0000sim_ios_active')).toBe(true);
    expect(platforms.has('sess_2\u0000sim_ios_2')).toBe(true);
  });
});
