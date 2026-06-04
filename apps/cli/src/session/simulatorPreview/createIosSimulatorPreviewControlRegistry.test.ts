import { describe, expect, it, vi } from 'vitest';

import { createIosSimulatorPreviewControlRegistry } from './createIosSimulatorPreviewControlRegistry';

describe('createIosSimulatorPreviewControlRegistry', () => {
  it('acquires a user lease and sends normalized tap through the iOS input bridge', async () => {
    const sendIosInput = vi.fn(async () => ({ ok: true as const }));
    const registry = createIosSimulatorPreviewControlRegistry({
      nowMs: () => 1_000,
      randomId: () => 'lease_user_1',
      sendIosInput,
    });

    registry.registerIosPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      deviceId: 'A1B2-C3D4',
      wdaUrl: 'http://127.0.0.1:8100',
    });

    await expect(registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      leaseTtlMs: 30_000,
    })).resolves.toEqual({
      ok: true,
      leaseId: 'lease_user_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      generation: 1,
      expiresAtMs: 31_000,
      mode: 'user_control',
    });

    await expect(registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    })).resolves.toEqual({ ok: true });
    expect(sendIosInput).toHaveBeenCalledWith({
      deviceId: 'A1B2-C3D4',
      wdaUrl: 'http://127.0.0.1:8100',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    });
  });

  it('rejects stale generations before iOS input is sent', async () => {
    const sendIosInput = vi.fn(async () => ({ ok: true as const }));
    const registry = createIosSimulatorPreviewControlRegistry({
      nowMs: () => 1_000,
      randomId: () => 'lease_user_1',
      sendIosInput,
    });

    registry.registerIosPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
    });
    await registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      owner: 'user',
    });

    await expect(registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      leaseId: 'lease_user_1',
      generation: 0,
      owner: 'user',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'stale_generation',
      error: 'stale_generation',
    });
    expect(sendIosInput).not.toHaveBeenCalled();
  });

  it('requires the matching holder id for holder-scoped iOS leases', async () => {
    const sendIosInput = vi.fn(async () => ({ ok: true as const }));
    const registry = createIosSimulatorPreviewControlRegistry({
      nowMs: () => 1_000,
      randomId: () => 'lease_user_1',
      sendIosInput,
    });

    registry.registerIosPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
    });
    await registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      owner: 'user',
      holderId: 'browser_tab_1',
    });

    await expect(registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'lease_holder_mismatch',
      error: 'lease_holder_mismatch',
    });
    await expect(registry.release({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      leaseId: 'lease_user_1',
      owner: 'user',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'lease_holder_mismatch',
      error: 'lease_holder_mismatch',
    });
    await expect(registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_ios_1',
      owner: 'user',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'control_busy',
      error: 'control_busy',
      owner: 'user',
    });
    expect(sendIosInput).not.toHaveBeenCalled();
  });

  it('clears stale session previews while preserving an excluded active preview', async () => {
    const registry = createIosSimulatorPreviewControlRegistry({
      nowMs: () => 1_000,
      randomId: () => 'lease_ios_active',
      sendIosInput: vi.fn(async () => ({ ok: true as const })),
    });
    registry.registerIosPreview({
      sessionId: 'sess_ios_clear_1',
      simulatorSessionId: 'sim_ios_old',
    });
    registry.registerIosPreview({
      sessionId: 'sess_ios_clear_1',
      simulatorSessionId: 'sim_ios_active',
    });
    registry.registerIosPreview({
      sessionId: 'sess_ios_other',
      simulatorSessionId: 'sim_ios_other',
    });

    registry.clearSessionPreviews({
      sessionId: 'sess_ios_clear_1',
      excludeSimulatorSessionId: 'sim_ios_active',
    });

    await expect(registry.acquire({
      sessionId: 'sess_ios_clear_1',
      simulatorSessionId: 'sim_ios_old',
      owner: 'user',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'simulator_preview_not_found',
    });
    await expect(registry.acquire({
      sessionId: 'sess_ios_clear_1',
      simulatorSessionId: 'sim_ios_active',
      owner: 'user',
    })).resolves.toMatchObject({
      ok: true,
      leaseId: 'lease_ios_active',
    });
    await expect(registry.acquire({
      sessionId: 'sess_ios_other',
      simulatorSessionId: 'sim_ios_other',
      owner: 'user',
    })).resolves.toMatchObject({
      ok: true,
    });
  });
});
