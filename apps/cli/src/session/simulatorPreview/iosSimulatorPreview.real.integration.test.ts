import { describe, expect, it } from 'vitest';

import { createIosSimulatorPreviewControlRegistry } from './createIosSimulatorPreviewControlRegistry';
import { startIosScreenshotMjpegStream } from './startIosScreenshotMjpegStream';

const ENABLED = process.env.HAPPIER_TEST_REAL_IOS_SIMULATOR_PREVIEW === '1';
const DEVICE_ID = process.env.HAPPIER_TEST_IOS_SIMULATOR_UDID?.trim() || undefined;
const WDA_URL = process.env.HAPPIER_TEST_IOS_WDA_URL?.trim() || 'http://127.0.0.1:8100';

describe.skipIf(!ENABLED)('iOS simulator preview real probe', { timeout: 30_000 }, () => {
  it('streams a real iOS Simulator screenshot frame and sends a center tap through WDA', async () => {
    const stream = await startIosScreenshotMjpegStream({
      host: '127.0.0.1',
      port: 0,
      pollIntervalMs: 1_000,
      ...(DEVICE_ID ? { deviceId: DEVICE_ID } : {}),
    });
    try {
      const frame = await fetch(stream.frameUrl);
      expect(frame.ok).toBe(true);
      expect(frame.headers.get('content-type')).toBe('image/jpeg');
      expect((await frame.arrayBuffer()).byteLength).toBeGreaterThan(0);
    } finally {
      await stream.close();
    }

    const registry = createIosSimulatorPreviewControlRegistry();
    registry.registerIosPreview({
      sessionId: 'real_ios_simulator_preview_probe',
      simulatorSessionId: 'real_ios_simulator_preview_probe',
      ...(DEVICE_ID ? { deviceId: DEVICE_ID } : {}),
      wdaUrl: WDA_URL,
    });

    const lease = await registry.acquire({
      sessionId: 'real_ios_simulator_preview_probe',
      simulatorSessionId: 'real_ios_simulator_preview_probe',
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
      throw new Error('expected real iOS simulator control lease');
    }

    await expect(registry.sendInput({
      sessionId: 'real_ios_simulator_preview_probe',
      simulatorSessionId: 'real_ios_simulator_preview_probe',
      leaseId: lease.leaseId,
      generation: lease.generation,
      owner: 'user',
      holderId: 'real_probe',
      input: { type: 'tap', x: 0.5, y: 0.5 },
    })).resolves.toEqual({ ok: true });
  });
});

describe.skipIf(ENABLED)('iOS simulator preview real probe disabled', () => {
  it('documents the opt-in gate for the real iOS Simulator probe', () => {
    expect(ENABLED).toBe(false);
  });
});
