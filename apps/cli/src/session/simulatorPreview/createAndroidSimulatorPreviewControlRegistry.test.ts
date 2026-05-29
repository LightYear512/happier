import { describe, expect, it, vi } from 'vitest';

import { createAndroidSimulatorPreviewControlRegistry } from './createAndroidSimulatorPreviewControlRegistry';

describe('createAndroidSimulatorPreviewControlRegistry', () => {
  it('acquires a user lease and sends a normalized tap through adb input', async () => {
    const runAdbInput = vi.fn(async () => {});
    const registry = createAndroidSimulatorPreviewControlRegistry({
      nowMs: () => 1_000,
      randomId: () => 'lease_user_1',
      runAdbInput,
    });

    registry.registerAndroidPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      deviceId: 'emulator-5554',
      deviceWidth: 1080,
      deviceHeight: 1920,
    });

    const lease = await registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      leaseTtlMs: 30_000,
    });
    expect(lease).toEqual({
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
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    })).resolves.toEqual({ ok: true });
    expect(runAdbInput).toHaveBeenCalledWith({
      deviceId: 'emulator-5554',
      input: { type: 'tap', x: 540, y: 480 },
    });
  });

  it('sends normalized swipe, text, and keyevent input through adb input', async () => {
    const runAdbInput = vi.fn(async () => {});
    const registry = createAndroidSimulatorPreviewControlRegistry({
      nowMs: () => 1_000,
      randomId: () => 'lease_user_1',
      runAdbInput,
    });

    registry.registerAndroidPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      deviceId: 'emulator-5554',
      deviceWidth: 1080,
      deviceHeight: 1920,
    });
    await registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      leaseTtlMs: 30_000,
    });

    await expect(registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'swipe', x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9, durationMs: 350 },
    })).resolves.toEqual({ ok: true });
    await expect(registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'text', text: 'hello world' },
    })).resolves.toEqual({ ok: true });
    await expect(registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'keyevent', key: 'back' },
    })).resolves.toEqual({ ok: true });

    expect(runAdbInput).toHaveBeenNthCalledWith(1, {
      deviceId: 'emulator-5554',
      input: { type: 'swipe', x1: 108, y1: 384, x2: 864, y2: 1728, durationMs: 350 },
    });
    expect(runAdbInput).toHaveBeenNthCalledWith(2, {
      deviceId: 'emulator-5554',
      input: { type: 'text', text: 'hello world' },
    });
    expect(runAdbInput).toHaveBeenNthCalledWith(3, {
      deviceId: 'emulator-5554',
      input: { type: 'keyevent', key: 'back' },
    });
  });

  it('records accepted and rejected input events in the audit timeline', async () => {
    let nowMs = 1_000;
    const registry = createAndroidSimulatorPreviewControlRegistry({
      nowMs: () => nowMs,
      randomId: () => 'lease_user_1',
      runAdbInput: vi.fn(async () => {}),
    });

    registry.registerAndroidPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      deviceWidth: 1080,
      deviceHeight: 1920,
    });
    await registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      leaseTtlMs: 1_000,
    });
    await registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    });
    nowMs = 2_001;
    await registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
      input: { type: 'keyevent', key: 'back' },
    });

    expect(registry.listInputTimeline({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
    })).toEqual([
      {
        atMs: 1_000,
        accepted: true,
        owner: 'user',
        holderId: 'browser_tab_1',
        generation: 1,
        input: { type: 'tap', x: 0.5, y: 0.25 },
      },
      {
        atMs: 2_001,
        accepted: false,
        errorCode: 'lease_expired',
        owner: 'user',
        holderId: 'browser_tab_1',
        generation: 1,
        input: { type: 'keyevent', key: 'back' },
      },
    ]);
  });

  it('validates the active lease before reload and reconnect dev service operations', async () => {
    const runAdbInput = vi.fn(async () => {});
    const runAdbReverse = vi.fn(async () => {});
    const registry = createAndroidSimulatorPreviewControlRegistry({
      nowMs: () => 1_000,
      randomId: () => 'lease_user_1',
      runAdbInput,
      runAdbReverse,
    });

    registry.registerAndroidPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      deviceId: 'emulator-5554',
      deviceWidth: 1080,
      deviceHeight: 1920,
      devServices: {
        metro: { status: 'connected', url: 'http://127.0.0.1:8081' },
        api: { status: 'healthy', url: 'http://localhost:3000' },
        hmr: { status: 'connected', url: 'ws://127.0.0.1:8081' },
      },
    });
    await registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
    });

    await expect(registry.reloadApp({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
    })).resolves.toEqual({ ok: true });
    await expect(registry.reconnectDevServices({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      holderId: 'browser_tab_1',
    })).resolves.toEqual({ ok: true, reconnectedPorts: [3000, 8081] });
    await expect(registry.reloadApp({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 0,
      owner: 'user',
      holderId: 'browser_tab_1',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'stale_generation',
      error: 'stale_generation',
    });

    expect(runAdbInput).toHaveBeenCalledTimes(2);
    expect(runAdbInput).toHaveBeenNthCalledWith(1, {
      deviceId: 'emulator-5554',
      input: { type: 'keyevent', key: 'reload_app' },
    });
    expect(runAdbInput).toHaveBeenNthCalledWith(2, {
      deviceId: 'emulator-5554',
      input: { type: 'keyevent', key: 'reload_app' },
    });
    expect(runAdbReverse).toHaveBeenCalledTimes(2);
    expect(runAdbReverse).toHaveBeenCalledWith({
      deviceId: 'emulator-5554',
      devicePort: 8081,
      hostPort: 8081,
    });
    expect(runAdbReverse).toHaveBeenCalledWith({
      deviceId: 'emulator-5554',
      devicePort: 3000,
      hostPort: 3000,
    });
  });

  it('rejects stale generations before adb input is sent', async () => {
    const runAdbInput = vi.fn(async () => {});
    const registry = createAndroidSimulatorPreviewControlRegistry({
      nowMs: () => 1_000,
      randomId: () => 'lease_user_1',
      runAdbInput,
    });

    registry.registerAndroidPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      deviceWidth: 1080,
      deviceHeight: 1920,
    });
    await registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      leaseTtlMs: 30_000,
    });

    await expect(registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 0,
      owner: 'user',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'stale_generation',
      error: 'stale_generation',
    });
    expect(runAdbInput).not.toHaveBeenCalled();
    expect(registry.listInputTimeline({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
    })[0]).toEqual(expect.objectContaining({
      accepted: false,
      errorCode: 'stale_generation',
    }));
  });

  it('rejects expired leases before adb input is sent', async () => {
    let nowMs = 1_000;
    const runAdbInput = vi.fn(async () => {});
    const registry = createAndroidSimulatorPreviewControlRegistry({
      nowMs: () => nowMs,
      randomId: () => 'lease_user_1',
      runAdbInput,
    });

    registry.registerAndroidPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      deviceWidth: 1080,
      deviceHeight: 1920,
    });
    await registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      leaseTtlMs: 1_000,
    });
    nowMs = 2_001;

    await expect(registry.sendInput({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_user_1',
      generation: 1,
      owner: 'user',
      input: { type: 'tap', x: 0.5, y: 0.25 },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'lease_expired',
      error: 'lease_expired',
    });
    expect(runAdbInput).not.toHaveBeenCalled();
  });

  it('rejects conflicting owners until the active lease is released', async () => {
    const registry = createAndroidSimulatorPreviewControlRegistry({
      nowMs: () => 1_000,
      randomId: vi
        .fn()
        .mockReturnValueOnce('lease_ai_1')
        .mockReturnValueOnce('lease_user_1'),
      runAdbInput: vi.fn(async () => {}),
    });

    registry.registerAndroidPreview({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      deviceWidth: 1080,
      deviceHeight: 1920,
    });
    await expect(registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'ai',
      holderId: 'agent_run_1',
      leaseTtlMs: 30_000,
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      leaseId: 'lease_ai_1',
      owner: 'ai',
      generation: 1,
      mode: 'ai_control',
    }));

    await expect(registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      leaseTtlMs: 30_000,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'control_busy',
      error: 'control_busy',
      owner: 'ai',
    });

    await expect(registry.release({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      leaseId: 'lease_ai_1',
      owner: 'ai',
      holderId: 'agent_run_1',
    })).resolves.toEqual({
      ok: true,
      generation: 2,
      mode: 'idle',
    });
    await expect(registry.acquire({
      sessionId: 'sess_1',
      simulatorSessionId: 'sim_android_1',
      owner: 'user',
      holderId: 'browser_tab_1',
      leaseTtlMs: 30_000,
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      leaseId: 'lease_user_1',
      owner: 'user',
      generation: 3,
      mode: 'user_control',
    }));
  });
});
