import { describe, expect, it } from 'vitest';

import { createAndroidSimulatorPreviewControlRegistry } from './createAndroidSimulatorPreviewControlRegistry';
import { resolveAndroidSimulatorPreviewGeometry } from './resolveAndroidSimulatorPreviewGeometry';

const ENABLED = process.env.HAPPIER_TEST_REAL_ANDROID_SIMULATOR_PREVIEW === '1';
const DEVICE_ID = process.env.HAPPIER_TEST_ANDROID_DEVICE_ID?.trim() || undefined;

describe.skipIf(!ENABLED)('Android simulator preview control real probe', { timeout: 20_000 }, () => {
  it('acquires a user lease and sends a center tap to a real Android emulator', async () => {
    const geometry = await resolveAndroidSimulatorPreviewGeometry({
      ...(DEVICE_ID ? { deviceId: DEVICE_ID } : {}),
    });
    const registry = createAndroidSimulatorPreviewControlRegistry();
    registry.registerAndroidPreview({
      sessionId: 'real_android_simulator_preview_probe',
      simulatorSessionId: 'real_android_simulator_preview_probe',
      ...(DEVICE_ID ? { deviceId: DEVICE_ID } : {}),
      ...geometry,
    });

    const lease = await registry.acquire({
      sessionId: 'real_android_simulator_preview_probe',
      simulatorSessionId: 'real_android_simulator_preview_probe',
      owner: 'user',
      holderId: 'real_probe',
      leaseTtlMs: 10_000,
    });
    expect(lease).toEqual(expect.objectContaining({
      ok: true,
      owner: 'user',
      mode: 'user_control',
    }));
    if (lease.ok !== true) {
      throw new Error('expected real Android simulator control lease');
    }

    await expect(registry.sendInput({
      sessionId: 'real_android_simulator_preview_probe',
      simulatorSessionId: 'real_android_simulator_preview_probe',
      leaseId: lease.leaseId,
      generation: lease.generation,
      owner: 'user',
      holderId: 'real_probe',
      input: { type: 'tap', x: 0.5, y: 0.5 },
    })).resolves.toEqual({ ok: true });
  });
});

describe.skipIf(ENABLED)('Android simulator preview control real probe disabled', () => {
  it('documents the opt-in gate for the real Android emulator probe', () => {
    expect(ENABLED).toBe(false);
  });
});
